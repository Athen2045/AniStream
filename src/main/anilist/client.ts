import { shell } from "electron";
import type {
  AniListAuthState,
  AniListCatalogPage,
  AniListDashboard,
  AniListMediaType,
  BrowseAniListInput,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { createBoundedCache } from "./cache";
import {
  deleteClientSecretFromKeychain,
  ensureClientSecret,
  isClientAuthenticationFailure,
  readClientSecretFromKeychain,
} from "./keychain";
import {
  normalizeAiringUpdates,
  normalizeCatalogPage,
  normalizeGroups,
  normalizeMediaDetail,
  normalizeMedia,
  normalizeProfile,
} from "./normalize";
import {
  ADD_ENTRY_MUTATION,
  AIRING_UPDATES_QUERY,
  BROWSE_MEDIA_QUERY,
  DASHBOARD_QUERY,
  DELETE_ENTRY_MUTATION,
  MEDIA_DETAIL_QUERY,
  SEARCH_MEDIA_QUERY,
  UPDATE_ENTRY_MUTATION,
  VIEWER_QUERY,
  type AiringUpdatesResponse,
  type BrowseResponse,
  type DashboardResponse,
  type GraphQlEnvelope,
  type MediaDetailResponse,
  type SearchResponse,
  type TokenResponse,
  type ViewerResponse,
} from "./queries";
import { createRequestGate, type RequestGate } from "./request-queue";
import { deleteSession, isMissingFileError, loadSession, saveSession } from "./session-store";
import type {
  AniListMedia,
  AniListMediaDetail,
  AniListProfile,
  LatestAnimeUpdate,
} from "../../shared/contracts";

const ANILIST_CLIENT_ID = "47053";
const ANILIST_REDIRECT_URI = "anistream://auth/anilist";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";

// AniList documents 90 req/min normally with a 30 req/min degraded-state warning (API.md).
// The client stays conservative and starts at 25 req/min while that warning remains.
const REQUESTS_PER_MINUTE = 25;
const BROWSE_CACHE_TTL_MS = 2 * 60_000;
const DETAIL_CACHE_TTL_MS = 5 * 60_000;
// New episodes air continuously; refetch the "latest updates" rail at most every 5 minutes.
const AIRING_CACHE_TTL_MS = 5 * 60_000;
const LATEST_ANIME_LIMIT = 20;
// Used only when AniList's 429 response has no Retry-After header to honor.
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

export class AniListClient {
  private token?: string;
  private profile?: AniListProfile;
  private authorizing = false;
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
  });
  private readonly browseCache = createBoundedCache<AniListCatalogPage>({
    maxEntries: 40,
    ttlMs: BROWSE_CACHE_TTL_MS,
  });
  private readonly detailCache = createBoundedCache<AniListMediaDetail>({
    maxEntries: 60,
    ttlMs: DETAIL_CACHE_TTL_MS,
  });
  private readonly airingCache = createBoundedCache<LatestAnimeUpdate[]>({
    maxEntries: 1,
    ttlMs: AIRING_CACHE_TTL_MS,
  });

  public constructor(
    private readonly tokenPath: string,
    private readonly emitState: (state: AniListAuthState) => void,
  ) {}

  public async restore(): Promise<AniListAuthState> {
    try {
      const { session, shouldReEncrypt } = await loadSession(this.tokenPath);
      this.token = session.token;
      this.profile = session.profile;

      if (shouldReEncrypt) {
        await this.persistToken(session.token);
      }

      if (!this.profile) {
        this.profile = await this.fetchProfile();
        await this.persistToken(session.token);
      }
      return { status: "signed-in", profile: this.profile };
    } catch (error) {
      if (isMissingFileError(error)) return { status: "signed-out" };
      this.token = undefined;
      this.profile = undefined;
      return {
        status: "error",
        message: "AniStream could not restore the saved AniList session.",
      };
    }
  }

  public getState(): AniListAuthState {
    if (this.authorizing) return { status: "authorizing" };
    if (this.profile) return { status: "signed-in", profile: this.profile };
    return { status: "signed-out" };
  }

  public async startLogin(): Promise<void> {
    await ensureClientSecret();

    const authorizeUrl = new URL(ANILIST_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", ANILIST_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", ANILIST_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");

    this.authorizing = true;
    this.emitState({ status: "authorizing" });

    try {
      await shell.openExternal(authorizeUrl.toString());
    } catch (error) {
      this.authorizing = false;
      this.emitState({
        status: "error",
        message: "The AniList sign-in page could not be opened.",
      });
      throw error;
    }
  }

  public async handleCallback(callbackUrl: string): Promise<void> {
    if (!this.authorizing) return;

    try {
      const url = new URL(callbackUrl);
      if (url.protocol !== "anistream:" || url.hostname !== "auth" || url.pathname !== "/anilist") {
        throw new Error("AniStream received an invalid AniList callback.");
      }

      const code = url.searchParams.get("code");
      if (!code) {
        const reason = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        throw new Error(reason ?? "AniList did not return an authorization code.");
      }

      const token = await this.exchangeAuthorizationCode(code);
      this.token = token;
      this.profile = await this.fetchProfile();
      await this.persistToken(token);
      this.emitState({ status: "signed-in", profile: this.profile });
    } catch (error) {
      await this.clearSession();
      this.emitState({
        status: "error",
        message: error instanceof Error ? error.message : "AniList sign-in failed.",
      });
    } finally {
      this.authorizing = false;
    }
  }

  public async logout(): Promise<void> {
    await this.clearSession();
    this.emitState({ status: "signed-out" });
  }

  public async getDashboard(): Promise<AniListDashboard> {
    const profile = this.profile ?? (await this.fetchProfile());
    this.profile = profile;

    const response = await this.request<DashboardResponse>(DASHBOARD_QUERY, {
      userId: profile.id,
    });

    return {
      profile,
      animeLists: normalizeGroups(response.anime, "ANIME"),
      mangaLists: normalizeGroups(response.manga, "MANGA"),
      fetchedAt: new Date().toISOString(),
    };
  }

  public async updateEntry(input: UpdateAniListEntryInput): Promise<void> {
    if (!Number.isInteger(input.id) || input.id <= 0) {
      throw new Error("Invalid AniList entry.");
    }

    await this.request(
      UPDATE_ENTRY_MUTATION,
      {
        id: input.id,
        status: input.status,
        score: input.score,
        progress: input.progress,
        progressVolumes: input.progressVolumes,
        repeat: input.repeat,
        notes: input.notes,
      },
      // No dedupe key: identical concurrent mutations must never be silently merged.
    );
  }

  public async searchMedia(query: string, type: AniListMediaType): Promise<AniListMedia[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || trimmedQuery.length > 120) {
      throw new Error("Search with between 2 and 120 characters.");
    }
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");

    const response = await this.request<SearchResponse>(
      SEARCH_MEDIA_QUERY,
      { query: trimmedQuery, type },
      `search:${type}:${trimmedQuery}`,
    );
    const page = asRecord(response.Page, "AniList returned an invalid search page.");
    if (!Array.isArray(page.media)) throw new Error("AniList returned invalid search results.");
    return page.media.map((media) => normalizeMedia(media, type));
  }

  public async browseMedia(input: BrowseAniListInput): Promise<AniListCatalogPage> {
    if (input.type !== "ANIME" && input.type !== "MANGA") {
      throw new Error("Invalid media type.");
    }
    if (!Number.isInteger(input.page) || input.page < 1 || input.page > 10_000) {
      throw new Error("Invalid catalog page.");
    }

    const perPage = input.perPage ?? 20;
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 30) {
      throw new Error("AniList pages must contain between 1 and 30 titles.");
    }

    const query = input.query?.trim();
    if (query && (query.length < 2 || query.length > 120)) {
      throw new Error("Search with between 2 and 120 characters.");
    }

    const allowedSorts = [
      "TRENDING_DESC",
      "POPULARITY_DESC",
      "SCORE_DESC",
      "START_DATE_DESC",
    ] as const;
    const sort = allowedSorts.includes(input.sort ?? "TRENDING_DESC")
      ? (input.sort ?? "TRENDING_DESC")
      : "TRENDING_DESC";

    const genre = input.genre?.trim();
    if (genre && (genre.length < 2 || genre.length > 80)) {
      throw new Error("Invalid AniList genre filter.");
    }

    const cacheKey = `browse:${input.type}:${input.page}:${perPage}:${sort}:${genre ?? ""}:${query ?? ""}`;
    const cached = this.browseCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.publicRequest<BrowseResponse>(
      BROWSE_MEDIA_QUERY,
      {
        page: input.page,
        perPage,
        type: input.type,
        search: query || undefined,
        genre: genre || undefined,
        sort: [sort],
      },
      cacheKey,
    );
    const page = normalizeCatalogPage(response.Page, input.type);
    this.browseCache.set(cacheKey, page);
    return page;
  }

  public async getLatestAnimeUpdates(): Promise<LatestAnimeUpdate[]> {
    const cached = this.airingCache.get("latest");
    if (cached) return cached;

    // Request more schedules than needed: consecutive rows often repeat a title
    // (batch uploads) and adult entries are filtered out after the fact.
    const response = await this.publicRequest<AiringUpdatesResponse>(
      AIRING_UPDATES_QUERY,
      { page: 1, perPage: 50 },
      "airing:latest",
    );
    const updates = normalizeAiringUpdates(response.Page, LATEST_ANIME_LIMIT);
    this.airingCache.set("latest", updates);
    return updates;
  }

  public async getMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList media.");
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");

    // Signed-in requests carry the viewer's list-entry context, so only cache
    // the signed-out (public) shape to avoid leaking one profile's entry into another's view.
    const cacheKey = this.token ? undefined : `detail:${type}:${id}`;
    if (cacheKey) {
      const cached = this.detailCache.get(cacheKey);
      if (cached) return cached;
    }

    const response = await this.publicRequest<MediaDetailResponse>(
      MEDIA_DETAIL_QUERY,
      { id, type },
      cacheKey ?? `detail-live:${type}:${id}`,
    );
    const detail = normalizeMediaDetail(response.Media, type);
    if (cacheKey) this.detailCache.set(cacheKey, detail);
    return detail;
  }

  public async addEntry(mediaId: number): Promise<void> {
    if (!Number.isInteger(mediaId) || mediaId <= 0) throw new Error("Invalid AniList media.");
    await this.request(ADD_ENTRY_MUTATION, { mediaId });
  }

  public async deleteEntry(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList entry.");
    await this.request(DELETE_ENTRY_MUTATION, { id });
  }

  private async fetchProfile(): Promise<AniListProfile> {
    const response = await this.request<ViewerResponse>(VIEWER_QUERY, {}, "viewer");
    return normalizeProfile(response.Viewer);
  }

  private async exchangeAuthorizationCode(code: string): Promise<string> {
    const clientSecret = await readClientSecretFromKeychain();
    if (!clientSecret) {
      throw new Error("The AniList client secret is missing from macOS Keychain.");
    }

    const response = await fetch(ANILIST_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ANILIST_CLIENT_ID,
        client_secret: clientSecret,
        redirect_uri: ANILIST_REDIRECT_URI,
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
      const providerMessage =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.error === "string"
            ? payload.error
            : undefined;

      if (response.status === 401 || isClientAuthenticationFailure(providerMessage)) {
        await deleteClientSecretFromKeychain();
        throw new Error(
          "AniList rejected the saved client secret. Click Continue with AniList again and enter the current secret from AniList Developer Settings.",
        );
      }

      throw new Error(providerMessage ?? `AniList token exchange failed (${response.status}).`);
    }

    return payload.access_token;
  }

  private async request<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    dedupeKey?: string,
  ): Promise<T> {
    if (!this.token) throw new Error("Connect your AniList account first.");
    const token = this.token;

    return this.requestGate.run(dedupeKey, async () => {
      const response = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });

      return this.parseGraphQlResponse<T>(response);
    });
  }

  private async publicRequest<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    dedupeKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    return this.requestGate.run(dedupeKey, async () => {
      const response = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });

      return this.parseGraphQlResponse<T>(response);
    });
  }

  /**
   * Shared response handling for both authenticated and public GraphQL calls. A 429
   * pauses the shared request gate for the server's Retry-After duration (falling back
   * to a conservative default when the header is absent) instead of just surfacing the
   * error, matching API.md: "On 429, stop the queue until Retry-After/reset."
   */
  private async parseGraphQlResponse<T>(response: Response): Promise<T> {
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      this.requestGate.reportRateLimited(retryAfterMs);
      throw new Error(
        "AniList is rate-limiting requests right now. AniStream will pause new requests briefly — please try again shortly.",
      );
    }

    const envelope = (await response.json()) as GraphQlEnvelope<T>;
    if (!response.ok || envelope.errors?.length || !envelope.data) {
      const message = envelope.errors?.[0]?.message;
      throw new Error(
        typeof message === "string" ? message : `AniList request failed (${response.status}).`,
      );
    }
    return envelope.data;
  }

  private async persistToken(token: string): Promise<void> {
    await saveSession(this.tokenPath, { token, profile: this.profile });
  }

  private async clearSession(): Promise<void> {
    this.token = undefined;
    this.profile = undefined;
    this.authorizing = false;
    await deleteSession(this.tokenPath);
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

/** Retry-After is either delta-seconds ("30") or an HTTP-date; falls back conservatively. */
export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RATE_LIMIT_PAUSE_MS;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return DEFAULT_RATE_LIMIT_PAUSE_MS;
}
