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
  normalizeAiringUpdatesPage,
  normalizeCatalogPage,
  normalizeGroups,
  normalizeListEntry,
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
  MANGA_KIND_HINTS_QUERY,
  SEARCH_MEDIA_QUERY,
  UPDATE_ENTRY_MUTATION,
  VIEWER_QUERY,
  type AiringUpdatesResponse,
  type BrowseResponse,
  type DashboardResponse,
  type GraphQlEnvelope,
  type MangaKindHintsResponse,
  type MediaDetailResponse,
  type SaveEntryResponse,
  type SearchResponse,
  type ViewerResponse,
} from "./queries";
import { createRequestGate, type RequestGate } from "./request-queue";
import { deleteSession, isMissingFileError, loadSession, saveSession } from "./session-store";
import { parseAniListMangaKindHints, type AniListMangaKindHint } from "../manga-kind";
import { AuthorizationTransaction } from "./authorization-transaction";
import type {
  AniListListEntrySummary,
  AniListMedia,
  AniListMediaDetail,
  AniListProfile,
  LatestAnimeUpdate,
  LatestUpdatesPage,
} from "../../shared/contracts";

const ANILIST_CLIENT_ID = "48271";
const ANILIST_REDIRECT_URI = "anistream://auth/anilist";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";

// AniList documents 90 req/min normally with a 30 req/min degraded-state warning (API.md).
// The client stays conservative and starts at 25 req/min while that warning remains.
const REQUESTS_PER_MINUTE = 25;
const BROWSE_CACHE_TTL_MS = 2 * 60_000;
const SEARCH_CACHE_TTL_MS = 2 * 60_000;
const DASHBOARD_CACHE_TTL_MS = 30_000;
const DETAIL_CACHE_TTL_MS = 5 * 60_000;
// New episodes air continuously; refetch the "latest updates" rail at most every 5 minutes.
const AIRING_CACHE_TTL_MS = 5 * 60_000;
const LATEST_UPDATE_PAGE_SIZE = 21;
const MANGA_KIND_CACHE_TTL_MS = 24 * 60 * 60_000;
// Used only when AniList's 429 response has no Retry-After header to honor.
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

// TODO: Move this public client ID into a small build-time config module if AniList changes it.

export class AniListClient {
  private token?: string;
  private profile?: AniListProfile;
  private readonly authorization: AuthorizationTransaction;
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
  });
  private readonly browseCache = createBoundedCache<AniListCatalogPage>({
    maxEntries: 40,
    ttlMs: BROWSE_CACHE_TTL_MS,
  });
  private readonly searchCache = createBoundedCache<AniListMedia[]>({
    maxEntries: 30,
    ttlMs: SEARCH_CACHE_TTL_MS,
  });
  private readonly dashboardCache = createBoundedCache<AniListDashboard>({
    maxEntries: 2,
    ttlMs: DASHBOARD_CACHE_TTL_MS,
  });
  private readonly detailCache = createBoundedCache<AniListMediaDetail>({
    maxEntries: 60,
    ttlMs: DETAIL_CACHE_TTL_MS,
  });
  private readonly airingCache = createBoundedCache<LatestUpdatesPage<LatestAnimeUpdate>>({
    maxEntries: 20,
    ttlMs: AIRING_CACHE_TTL_MS,
  });
  private readonly mangaKindCache = createBoundedCache<AniListMangaKindHint>({
    maxEntries: 240,
    ttlMs: MANGA_KIND_CACHE_TTL_MS,
  });

  public constructor(
    private readonly tokenPath: string,
    private readonly emitState: (state: AniListAuthState) => void,
  ) {
    this.authorization = new AuthorizationTransaction({
      timeoutMs: AUTHORIZATION_TIMEOUT_MS,
      onTimeout: () =>
        this.emitState({
          status: "error",
          message: "AniList sign-in timed out. Start it again when you are ready.",
        }),
    });
  }

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
    if (this.authorization.active) return { status: "authorizing" };
    if (this.profile) return { status: "signed-in", profile: this.profile };
    return { status: "signed-out" };
  }

  public async startLogin(): Promise<void> {
    const authorizeUrl = new URL(ANILIST_AUTHORIZE_URL);
    authorizeUrl.searchParams.set("client_id", ANILIST_CLIENT_ID);
    // AniList's implicit-grant example intentionally sends no redirect_uri. The
    // callback is selected from the redirect URL registered for this client.
    authorizeUrl.searchParams.set("response_type", "token");

    this.authorization.begin();
    this.emitState({ status: "authorizing" });

    try {
      await shell.openExternal(authorizeUrl.toString());
    } catch (error) {
      this.authorization.cancel();
      this.emitState({
        status: "error",
        message: error instanceof Error ? error.message : "AniList sign-in could not be started.",
      });
      throw error;
    }
  }

  public async handleCallback(callbackUrl: string): Promise<void> {
    try {
      const result = await this.authorization.handleCallback(async (signal) => {
        const url = new URL(callbackUrl);
        const expectedCallback = new URL(ANILIST_REDIRECT_URI);
        if (
          url.protocol !== expectedCallback.protocol ||
          url.hostname !== expectedCallback.hostname ||
          url.pathname !== expectedCallback.pathname
        ) {
          throw new Error("AniStream received an invalid AniList callback.");
        }

        const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
        const token = params.get("access_token");
        if (!token) {
          const reason =
            url.searchParams.get("error_description") ??
            url.searchParams.get("error") ??
            params.get("error_description") ??
            params.get("error");
          throw new Error(reason ?? "AniList did not return an access token.");
        }

        this.token = token;
        this.profile = await this.fetchProfile();
        if (signal.aborted) throw new DOMException("AniList sign-in was cancelled.", "AbortError");
        await this.persistToken(token);
      });
      if (!result.handled) return;
      if (!this.profile) throw new Error("AniList profile loading did not complete.");
      this.emitState({ status: "signed-in", profile: this.profile });
    } catch (error) {
      await this.clearSession();
      this.emitState({
        status: "error",
        message: error instanceof Error ? error.message : "AniList sign-in failed.",
      });
    }
  }

  public cancelLogin(): void {
    if (!this.authorization.cancel()) return;
    this.emitState(
      this.profile ? { status: "signed-in", profile: this.profile } : { status: "signed-out" },
    );
  }

  public async logout(): Promise<void> {
    this.authorization.cancel();
    await this.clearSession();
    this.emitState({ status: "signed-out" });
  }

  public async getDashboard(): Promise<AniListDashboard> {
    const profile = this.profile ?? (await this.fetchProfile());
    this.profile = profile;
    const cacheKey = `dashboard:${profile.id}`;
    const cached = this.dashboardCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.request<DashboardResponse>(
      DASHBOARD_QUERY,
      {
        userId: profile.id,
      },
      cacheKey,
    );

    const dashboard = {
      profile,
      animeLists: normalizeGroups(response.anime, "ANIME"),
      mangaLists: normalizeGroups(response.manga, "MANGA"),
      fetchedAt: new Date().toISOString(),
    };
    this.dashboardCache.set(cacheKey, dashboard);
    return dashboard;
  }

  public async updateEntry(input: UpdateAniListEntryInput): Promise<AniListListEntrySummary> {
    if (!Number.isInteger(input.id) || input.id <= 0) {
      throw new Error("Invalid AniList entry.");
    }

    const response = await this.request<SaveEntryResponse>(
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
    this.invalidateViewerData();
    return normalizeListEntry(response.SaveMediaListEntry);
  }

  public async searchMedia(query: string, type: AniListMediaType): Promise<AniListMedia[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || trimmedQuery.length > 120) {
      throw new Error("Search with between 2 and 120 characters.");
    }
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");
    const cacheKey = `search:${type}:${trimmedQuery.toLocaleLowerCase()}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.request<SearchResponse>(
      SEARCH_MEDIA_QUERY,
      { query: trimmedQuery, type },
      cacheKey,
    );
    const page = asRecord(response.Page, "AniList returned an invalid search page.");
    if (!Array.isArray(page.media)) throw new Error("AniList returned invalid search results.");
    const results = page.media.map((media) => normalizeMedia(media, type));
    this.searchCache.set(cacheKey, results);
    return results;
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

  public async getLatestAnimeUpdates(page: number): Promise<LatestUpdatesPage<LatestAnimeUpdate>> {
    if (!Number.isInteger(page) || page < 1 || page > 5_000) {
      throw new Error("Invalid latest anime page.");
    }
    const cacheKey = `latest:${page}`;
    const cached = this.airingCache.get(cacheKey);
    if (cached) return cached;

    // Request more schedules than needed because consecutive rows can repeat a
    // title after batch uploads; normalization keeps the newest row per title.
    const response = await this.publicRequest<AiringUpdatesResponse>(
      AIRING_UPDATES_QUERY,
      { page, perPage: 50 },
      `airing:${page}`,
    );
    const updates = normalizeAiringUpdatesPage(response.Page, LATEST_UPDATE_PAGE_SIZE);
    this.airingCache.set(cacheKey, updates);
    return updates;
  }

  public async getMangaKindHints(ids: number[]): Promise<Map<number, AniListMangaKindHint>> {
    const uniqueIds = [
      ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)),
    ].slice(0, 50);
    const hints = new Map<number, AniListMangaKindHint>();
    const missing: number[] = [];
    for (const id of uniqueIds) {
      const cached = this.mangaKindCache.get(String(id));
      if (cached) hints.set(id, cached);
      else missing.push(id);
    }
    if (!missing.length) return hints;

    const response = await this.publicRequest<MangaKindHintsResponse>(
      MANGA_KIND_HINTS_QUERY,
      { ids: missing },
      `manga-kind:${missing.join(",")}`,
    );
    const page = asRecord(response.Page, "AniList returned invalid manga-kind data.");
    for (const hint of parseAniListMangaKindHints(page)) {
      this.mangaKindCache.set(String(hint.aniListId), hint);
      hints.set(hint.aniListId, hint);
    }
    return hints;
  }

  public async getMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList media.");
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");

    // Include the active profile in the key so the signed-in list-entry context
    // can be cached safely for this single-user app.
    const cacheKey = `detail:${this.profile?.id ?? "public"}:${type}:${id}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached) return cached;

    const response = await this.publicRequest<MediaDetailResponse>(
      MEDIA_DETAIL_QUERY,
      { id, type },
      cacheKey,
    );
    const detail = normalizeMediaDetail(response.Media, type);
    this.detailCache.set(cacheKey, detail);
    return detail;
  }

  public async addEntry(mediaId: number): Promise<AniListListEntrySummary> {
    if (!Number.isInteger(mediaId) || mediaId <= 0) throw new Error("Invalid AniList media.");
    const response = await this.request<SaveEntryResponse>(ADD_ENTRY_MUTATION, { mediaId });
    this.invalidateViewerData();
    return normalizeListEntry(response.SaveMediaListEntry);
  }

  public async deleteEntry(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList entry.");
    await this.request(DELETE_ENTRY_MUTATION, { id });
    this.invalidateViewerData();
  }

  private async fetchProfile(): Promise<AniListProfile> {
    const response = await this.request<ViewerResponse>(VIEWER_QUERY, {}, "viewer");
    return normalizeProfile(response.Viewer);
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
    this.authorization.cancel();
    this.token = undefined;
    this.profile = undefined;
    await deleteSession(this.tokenPath);
    this.invalidateViewerData();
  }

  private invalidateViewerData(): void {
    this.dashboardCache.clear();
    this.detailCache.clear();
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
