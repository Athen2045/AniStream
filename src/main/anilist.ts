import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { safeStorage, shell } from "electron";
import type {
  AniListAuthState,
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListDashboard,
  AniListEntry,
  AniListEntryStatus,
  AniListGroup,
  AniListMedia,
  AniListMediaDetail,
  AniListMediaType,
  AniListNamedPerson,
  AniListProfile,
  BrowseAniListInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";

const ANILIST_CLIENT_ID = "47053";
const ANILIST_REDIRECT_URI = "anistream://auth/anilist";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const ANILIST_KEYCHAIN_SERVICE = "dev.anistream.desktop.anilist-client";
const ANILIST_KEYCHAIN_ACCOUNT = "AniStream";
const execFileAsync = promisify(execFile);

const DASHBOARD_QUERY = `
  query AniStreamDashboard($userId: Int!) {
    anime: MediaListCollection(type: ANIME, userId: $userId) {
      lists {
        name
        isCustomList
        entries {
          ...AniStreamEntry
        }
      }
    }
    manga: MediaListCollection(type: MANGA, userId: $userId) {
      lists {
        name
        isCustomList
        entries {
          ...AniStreamEntry
        }
      }
    }
  }

  fragment AniStreamEntry on MediaList {
    id
    status
    score(format: POINT_10_DECIMAL)
    progress
    progressVolumes
    repeat
    notes
    updatedAt
    media {
      id
      type
      title {
        userPreferred
        english
        romaji
      }
      coverImage {
        large
      }
      format
      status
      episodes
      chapters
      volumes
      siteUrl
    }
  }
`;

const VIEWER_QUERY = `
  query AniStreamViewer {
    Viewer {
      id
      name
      about
      avatar {
        large
      }
      bannerImage
      siteUrl
      statistics {
        anime {
          count
          episodesWatched
          minutesWatched
        }
        manga {
          count
          chaptersRead
          volumesRead
        }
      }
    }
  }
`;

const UPDATE_ENTRY_MUTATION = `
  mutation UpdateAniStreamEntry(
    $id: Int!
    $status: MediaListStatus
    $score: Float
    $progress: Int
    $progressVolumes: Int
    $repeat: Int
    $notes: String
  ) {
    SaveMediaListEntry(
      id: $id
      status: $status
      score: $score
      progress: $progress
      progressVolumes: $progressVolumes
      repeat: $repeat
      notes: $notes
    ) {
      id
    }
  }
`;

const DELETE_ENTRY_MUTATION = `
  mutation DeleteAniStreamEntry($id: Int!) {
    DeleteMediaListEntry(id: $id) {
      deleted
    }
  }
`;

const SEARCH_MEDIA_QUERY = `
  query SearchAniStreamMedia($query: String!, $type: MediaType!) {
    Page(page: 1, perPage: 12) {
      media(search: $query, type: $type, isAdult: false) {
        id
        type
        title {
          userPreferred
          english
          romaji
        }
        coverImage {
          large
        }
        format
        status
        episodes
        chapters
        volumes
        siteUrl
      }
    }
  }
`;

const ADD_ENTRY_MUTATION = `
  mutation AddAniStreamEntry($mediaId: Int!) {
    SaveMediaListEntry(mediaId: $mediaId, status: PLANNING) {
      id
    }
  }
`;

const CATALOG_MEDIA_FIELDS = `
  fragment AniStreamCatalogMedia on Media {
    id
    type
    title {
      userPreferred
      english
      romaji
    }
    coverImage {
      extraLarge
      large
    }
    bannerImage
    description(asHtml: false)
    format
    status
    episodes
    chapters
    volumes
    siteUrl
    genres
    averageScore
    popularity
    season
    seasonYear
    nextAiringEpisode {
      episode
      airingAt
    }
  }
`;

const BROWSE_MEDIA_QUERY = `
  query BrowseAniStreamMedia(
    $page: Int!
    $perPage: Int!
    $type: MediaType!
    $search: String
    $sort: [MediaSort!]!
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        perPage
        lastPage
        hasNextPage
      }
      media(type: $type, search: $search, sort: $sort, isAdult: false) {
        ...AniStreamCatalogMedia
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

const MEDIA_DETAIL_QUERY = `
  query AniStreamMediaDetail($id: Int!, $type: MediaType!) {
    Media(id: $id, type: $type) {
      ...AniStreamCatalogMedia
      title {
        userPreferred
        romaji
        english
        native
      }
      synonyms
      source
      countryOfOrigin
      duration
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      studios {
        edges {
          isMain
          node {
            name
          }
        }
      }
      characters(page: 1, perPage: 12, sort: [ROLE, RELEVANCE, ID]) {
        edges {
          role
          node {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
      staff(page: 1, perPage: 12, sort: [RELEVANCE, ID]) {
        edges {
          role
          node {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
      relations {
        edges {
          relationType
          node {
            ...AniStreamCatalogMedia
          }
        }
      }
      recommendations(page: 1, perPage: 12, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            ...AniStreamCatalogMedia
          }
        }
      }
      externalLinks {
        site
        url
        type
      }
      trailer {
        id
        site
      }
      mediaListEntry {
        id
        status
        score(format: POINT_10_DECIMAL)
        progress
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

interface GraphQlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: unknown }>;
}

interface ViewerResponse {
  Viewer?: unknown;
}

interface DashboardResponse {
  anime?: unknown;
  manga?: unknown;
}

interface SearchResponse {
  Page?: unknown;
}

interface BrowseResponse {
  Page?: unknown;
}

interface MediaDetailResponse {
  Media?: unknown;
}

interface TokenResponse {
  access_token?: unknown;
  error?: unknown;
  message?: unknown;
}

export class AniListClient {
  private token?: string;
  private profile?: AniListProfile;
  private authorizing = false;

  public constructor(
    private readonly tokenPath: string,
    private readonly emitState: (state: AniListAuthState) => void,
  ) {}

  public async restore(): Promise<AniListAuthState> {
    try {
      const encrypted = await readFile(this.tokenPath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const session = parseStoredSession(decrypted.result);
      this.token = session.token;
      this.profile = session.profile;

      if (decrypted.shouldReEncrypt) {
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

    await this.request(UPDATE_ENTRY_MUTATION, {
      id: input.id,
      status: input.status,
      score: input.score,
      progress: input.progress,
      progressVolumes: input.progressVolumes,
      repeat: input.repeat,
      notes: input.notes,
    });
  }

  public async searchMedia(query: string, type: AniListMediaType): Promise<AniListMedia[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2 || trimmedQuery.length > 120) {
      throw new Error("Search with between 2 and 120 characters.");
    }
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");

    const response = await this.request<SearchResponse>(SEARCH_MEDIA_QUERY, {
      query: trimmedQuery,
      type,
    });
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

    const response = await this.publicRequest<BrowseResponse>(BROWSE_MEDIA_QUERY, {
      page: input.page,
      perPage,
      type: input.type,
      search: query || undefined,
      sort: [sort],
    });
    return normalizeCatalogPage(response.Page, input.type);
  }

  public async getMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList media.");
    if (type !== "ANIME" && type !== "MANGA") throw new Error("Invalid media type.");
    const response = await this.publicRequest<MediaDetailResponse>(MEDIA_DETAIL_QUERY, { id, type });
    return normalizeMediaDetail(response.Media, type);
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
    const response = await this.request<ViewerResponse>(VIEWER_QUERY);
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
  ): Promise<T> {
    if (!this.token) throw new Error("Connect your AniList account first.");

    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });

    const envelope = (await response.json()) as GraphQlEnvelope<T>;
    if (!response.ok || envelope.errors?.length || !envelope.data) {
      const message = envelope.errors?.[0]?.message;
      throw new Error(typeof message === "string" ? message : `AniList request failed (${response.status}).`);
    }

    return envelope.data;
  }

  private async publicRequest<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(ANILIST_GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });

    const envelope = (await response.json()) as GraphQlEnvelope<T>;
    if (!response.ok || envelope.errors?.length || !envelope.data) {
      const message = envelope.errors?.[0]?.message;
      throw new Error(typeof message === "string" ? message : `AniList request failed (${response.status}).`);
    }
    return envelope.data;
  }

  private async persistToken(token: string): Promise<void> {
    const session = JSON.stringify({ version: 1, token, profile: this.profile });
    const encrypted = await safeStorage.encryptStringAsync(session);
    await writeFile(this.tokenPath, encrypted, { mode: 0o600 });
  }

  private async clearSession(): Promise<void> {
    this.token = undefined;
    this.profile = undefined;
    this.authorizing = false;
    await unlink(this.tokenPath).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    });
  }
}

function normalizeProfile(value: unknown): AniListProfile {
  const viewer = asRecord(value, "AniList returned an invalid profile.");
  const avatar = asRecord(viewer.avatar, "AniList returned an invalid avatar.");
  const statistics = asRecord(viewer.statistics, "AniList returned invalid statistics.");
  const anime = asRecord(statistics.anime, "AniList returned invalid anime statistics.");
  const manga = asRecord(statistics.manga, "AniList returned invalid manga statistics.");

  return {
    id: requiredNumber(viewer.id, "profile ID"),
    name: requiredString(viewer.name, "profile name"),
    about: optionalString(viewer.about),
    avatarUrl: requiredString(avatar.large, "avatar"),
    bannerUrl: optionalString(viewer.bannerImage),
    siteUrl: requiredString(viewer.siteUrl, "profile URL"),
    animeCount: requiredNumber(anime.count, "anime count"),
    episodesWatched: requiredNumber(anime.episodesWatched, "episodes watched"),
    minutesWatched: requiredNumber(anime.minutesWatched, "minutes watched"),
    mangaCount: requiredNumber(manga.count, "manga count"),
    chaptersRead: requiredNumber(manga.chaptersRead, "chapters read"),
    volumesRead: requiredNumber(manga.volumesRead, "volumes read"),
  };
}

function normalizeGroups(collectionValue: unknown, expectedType: AniListMediaType): AniListGroup[] {
  const collection = asRecord(collectionValue, "AniList returned an invalid media list.");
  if (!Array.isArray(collection.lists)) throw new Error("AniList returned invalid list groups.");

  return collection.lists.map((listValue): AniListGroup => {
    const list = asRecord(listValue, "AniList returned an invalid list group.");
    if (!Array.isArray(list.entries)) throw new Error("AniList returned invalid list entries.");

    return {
      name: requiredString(list.name, "list name"),
      isCustomList: Boolean(list.isCustomList),
      entries: list.entries.map((entry) => normalizeEntry(entry, expectedType)),
    };
  });
}

function normalizeEntry(value: unknown, expectedType: AniListMediaType): AniListEntry {
  const entry = asRecord(value, "AniList returned an invalid list entry.");
  const status = requiredString(entry.status, "entry status");

  if (!isEntryStatus(status)) throw new Error(`AniList returned an unknown list status: ${status}`);

  return {
    id: requiredNumber(entry.id, "entry ID"),
    status,
    score: requiredNumber(entry.score, "entry score"),
    progress: requiredNumber(entry.progress, "entry progress"),
    progressVolumes: optionalNumber(entry.progressVolumes),
    repeat: requiredNumber(entry.repeat, "entry repeat"),
    notes: optionalString(entry.notes),
    updatedAt: requiredNumber(entry.updatedAt, "entry update time"),
    media: normalizeMedia(entry.media, expectedType),
  };
}

function normalizeMedia(value: unknown, expectedType: AniListMediaType): AniListMedia {
  const media = asRecord(value, "AniList returned invalid media.");
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const cover = asRecord(media.coverImage, "AniList returned an invalid cover.");
  const mediaType = requiredString(media.type, "media type");
  if (mediaType !== expectedType) throw new Error("AniList returned a mismatched media type.");

  const preferredTitle =
    optionalString(title.userPreferred) ?? optionalString(title.english) ?? optionalString(title.romaji);
  if (!preferredTitle) throw new Error("AniList returned media without a title.");

  return {
    id: requiredNumber(media.id, "media ID"),
    type: expectedType,
    title: preferredTitle,
    coverUrl: requiredString(cover.large, "cover image"),
    format: optionalString(media.format),
    status: optionalString(media.status),
    totalProgress:
      expectedType === "ANIME" ? optionalNumber(media.episodes) : optionalNumber(media.chapters),
    totalVolumes: optionalNumber(media.volumes),
    siteUrl: requiredString(media.siteUrl, "media URL"),
  };
}

function normalizeCatalogPage(
  value: unknown,
  expectedType: AniListMediaType,
): AniListCatalogPage {
  const page = asRecord(value, "AniList returned an invalid catalog page.");
  const pageInfo = asRecord(page.pageInfo, "AniList returned invalid pagination.");
  if (!Array.isArray(page.media)) throw new Error("AniList returned invalid catalog results.");

  const currentPage = requiredNumber(pageInfo.currentPage, "current page");
  const rawLastPage = optionalNumber(pageInfo.lastPage);

  return {
    pageInfo: {
      currentPage,
      perPage: requiredNumber(pageInfo.perPage, "page size"),
      lastPage: Math.max(currentPage, rawLastPage ?? currentPage),
      hasNextPage: Boolean(pageInfo.hasNextPage),
    },
    items: page.media.map((media) => normalizeCatalogMedia(media, expectedType)),
  };
}

function normalizeCatalogMedia(
  value: unknown,
  expectedType: AniListMediaType,
): AniListCatalogMedia {
  const media = asRecord(value, "AniList returned invalid catalog media.");
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const cover = asRecord(media.coverImage, "AniList returned an invalid cover.");
  const mediaType = requiredString(media.type, "media type");
  if (mediaType !== expectedType) throw new Error("AniList returned a mismatched media type.");
  const preferredTitle =
    optionalString(title.userPreferred) ?? optionalString(title.english) ?? optionalString(title.romaji);
  if (!preferredTitle) throw new Error("AniList returned media without a title.");

  const nextAiring = media.nextAiringEpisode
    ? asRecord(media.nextAiringEpisode, "AniList returned an invalid airing schedule.")
    : undefined;

  return {
    id: requiredNumber(media.id, "media ID"),
    type: expectedType,
    title: preferredTitle,
    coverUrl:
      optionalString(cover.extraLarge) ??
      requiredString(cover.large, "cover image"),
    bannerUrl: optionalString(media.bannerImage),
    description: optionalString(media.description),
    format: optionalString(media.format),
    status: optionalString(media.status),
    totalProgress:
      expectedType === "ANIME" ? optionalNumber(media.episodes) : optionalNumber(media.chapters),
    totalVolumes: optionalNumber(media.volumes),
    siteUrl: requiredString(media.siteUrl, "media URL"),
    genres: Array.isArray(media.genres)
      ? media.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    averageScore: optionalNumber(media.averageScore),
    popularity: optionalNumber(media.popularity),
    season: optionalString(media.season),
    seasonYear: optionalNumber(media.seasonYear),
    nextAiringEpisode: nextAiring
      ? {
          episode: requiredNumber(nextAiring.episode, "next episode"),
          airingAt: requiredNumber(nextAiring.airingAt, "airing time"),
        }
      : undefined,
  };
}

function normalizeMediaDetail(
  value: unknown,
  expectedType: AniListMediaType,
): AniListMediaDetail {
  const media = asRecord(value, "AniList returned invalid media details.");
  const base = normalizeCatalogMedia(media, expectedType);
  const title = asRecord(media.title, "AniList returned an invalid title.");
  const studios = media.studios
    ? asRecord(media.studios, "AniList returned invalid studios.")
    : undefined;
  const studioEdges = studios && Array.isArray(studios.edges) ? studios.edges : [];

  const mainStudios: string[] = [];
  const producers: string[] = [];
  for (const edgeValue of studioEdges) {
    const edge = asRecord(edgeValue, "AniList returned an invalid studio.");
    const node = asRecord(edge.node, "AniList returned an invalid studio.");
    const name = requiredString(node.name, "studio name");
    (edge.isMain ? mainStudios : producers).push(name);
  }

  const characters = normalizePeopleConnection(media.characters, "character");
  const staff = normalizePeopleConnection(media.staff, "staff");
  const relationsConnection = media.relations
    ? asRecord(media.relations, "AniList returned invalid relations.")
    : undefined;
  const relationEdges =
    relationsConnection && Array.isArray(relationsConnection.edges)
      ? relationsConnection.edges
      : [];
  const relations = relationEdges.flatMap((edgeValue) => {
    const edge = asRecord(edgeValue, "AniList returned an invalid relation.");
    if (!edge.node) return [];
    return [{
      relationType: requiredString(edge.relationType, "relation type"),
      media: normalizeCatalogMedia(edge.node, requiredMediaType(edge.node)),
    }];
  });

  const recommendationConnection = media.recommendations
    ? asRecord(media.recommendations, "AniList returned invalid recommendations.")
    : undefined;
  const recommendationNodes =
    recommendationConnection && Array.isArray(recommendationConnection.nodes)
      ? recommendationConnection.nodes
      : [];
  const recommendations = recommendationNodes.flatMap((recommendationValue) => {
    const recommendation = asRecord(
      recommendationValue,
      "AniList returned an invalid recommendation.",
    );
    if (!recommendation.mediaRecommendation) return [];
    return [
      normalizeCatalogMedia(
        recommendation.mediaRecommendation,
        requiredMediaType(recommendation.mediaRecommendation),
      ),
    ];
  });

  const externalLinks = Array.isArray(media.externalLinks)
    ? media.externalLinks.flatMap((linkValue) => {
        const link = asRecord(linkValue, "AniList returned an invalid external link.");
        const site = optionalString(link.site);
        const url = optionalString(link.url);
        return site && url ? [{ site, url, type: optionalString(link.type) }] : [];
      })
    : [];

  const trailer = media.trailer
    ? asRecord(media.trailer, "AniList returned an invalid trailer.")
    : undefined;
  const trailerId = trailer ? optionalString(trailer.id) : undefined;
  const trailerSite = trailer ? optionalString(trailer.site)?.toLocaleLowerCase() : undefined;

  const listEntry = media.mediaListEntry
    ? asRecord(media.mediaListEntry, "AniList returned an invalid list entry.")
    : undefined;
  const listStatus = listEntry ? requiredString(listEntry.status, "entry status") : undefined;

  return {
    ...base,
    titleRomaji: optionalString(title.romaji),
    titleEnglish: optionalString(title.english),
    titleNative: optionalString(title.native),
    synonyms: Array.isArray(media.synonyms)
      ? media.synonyms.filter((synonym): synonym is string => typeof synonym === "string")
      : [],
    source: optionalString(media.source),
    countryOfOrigin: optionalString(media.countryOfOrigin),
    duration: optionalNumber(media.duration),
    startDate: normalizeFuzzyDate(media.startDate),
    endDate: normalizeFuzzyDate(media.endDate),
    studios: mainStudios.length ? mainStudios : producers,
    producers,
    characters,
    staff,
    relations,
    recommendations,
    externalLinks,
    trailerUrl:
      trailerId && trailerSite === "youtube"
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailerId)}`
        : trailerId && trailerSite === "dailymotion"
          ? `https://www.dailymotion.com/video/${encodeURIComponent(trailerId)}`
          : undefined,
    listEntry:
      listEntry && listStatus && isEntryStatus(listStatus)
        ? {
            id: requiredNumber(listEntry.id, "entry ID"),
            status: listStatus,
            score: requiredNumber(listEntry.score, "entry score"),
            progress: requiredNumber(listEntry.progress, "entry progress"),
          }
        : undefined,
  };
}

function normalizePeopleConnection(value: unknown, kind: string): AniListNamedPerson[] {
  if (!value) return [];
  const connection = asRecord(value, `AniList returned invalid ${kind} data.`);
  if (!Array.isArray(connection.edges)) return [];
  return connection.edges.flatMap((edgeValue) => {
    const edge = asRecord(edgeValue, `AniList returned an invalid ${kind}.`);
    if (!edge.node) return [];
    const node = asRecord(edge.node, `AniList returned an invalid ${kind}.`);
    const name = asRecord(node.name, `AniList returned an invalid ${kind} name.`);
    const image = node.image
      ? asRecord(node.image, `AniList returned an invalid ${kind} image.`)
      : undefined;
    return [{
      id: requiredNumber(node.id, `${kind} ID`),
      name: requiredString(name.full, `${kind} name`),
      imageUrl: image ? optionalString(image.medium) : undefined,
      role: optionalString(edge.role),
    }];
  });
}

function normalizeFuzzyDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = asRecord(value, "AniList returned an invalid date.");
  const year = optionalNumber(date.year);
  if (!year) return undefined;
  const month = optionalNumber(date.month);
  const day = optionalNumber(date.day);
  return [year, month, day]
    .filter((part): part is number => typeof part === "number")
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("-");
}

function requiredMediaType(value: unknown): AniListMediaType {
  const record = asRecord(value, "AniList returned invalid related media.");
  const type = requiredString(record.type, "media type");
  if (type !== "ANIME" && type !== "MANGA") throw new Error("AniList returned an unknown media type.");
  return type;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`AniList returned an invalid ${field}.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`AniList returned an invalid ${field}.`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isEntryStatus(value: string): value is AniListEntryStatus {
  return ["CURRENT", "PLANNING", "COMPLETED", "DROPPED", "PAUSED", "REPEATING"].includes(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseStoredSession(value: string): { token: string; profile?: AniListProfile } {
  try {
    const parsed = JSON.parse(value) as unknown;
    const record = asRecord(parsed, "AniStream saved an invalid session.");
    const token = requiredString(record.token, "saved access token");
    return {
      token,
      profile: isStoredProfile(record.profile) ? record.profile : undefined,
    };
  } catch {
    if (value.trim()) return { token: value.trim() };
    throw new Error("AniStream saved an empty session.");
  }
}

function isStoredProfile(value: unknown): value is AniListProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === "number" &&
    typeof profile.name === "string" &&
    typeof profile.avatarUrl === "string" &&
    typeof profile.siteUrl === "string" &&
    typeof profile.animeCount === "number" &&
    typeof profile.episodesWatched === "number" &&
    typeof profile.minutesWatched === "number" &&
    typeof profile.mangaCount === "number" &&
    typeof profile.chaptersRead === "number" &&
    typeof profile.volumesRead === "number"
  );
}

async function readClientSecretFromKeychain(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        ANILIST_KEYCHAIN_ACCOUNT,
        "-s",
        ANILIST_KEYCHAIN_SERVICE,
        "-w",
      ],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
      },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function deleteClientSecretFromKeychain(): Promise<void> {
  try {
    await execFileAsync(
      "/usr/bin/security",
      [
        "delete-generic-password",
        "-a",
        ANILIST_KEYCHAIN_ACCOUNT,
        "-s",
        ANILIST_KEYCHAIN_SERVICE,
      ],
      {
        encoding: "utf8",
        maxBuffer: 4_096,
      },
    );
  } catch {
    // A missing Keychain item already leaves the app in the desired state.
  }
}

function isClientAuthenticationFailure(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLocaleLowerCase();
  return normalized.includes("client authentication") || normalized.includes("invalid_client");
}

async function ensureClientSecret(): Promise<string> {
  const existingSecret = await readClientSecretFromKeychain();
  if (existingSecret) return existingSecret;

  const clientSecret = await promptForClientSecret();
  await execFileAsync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      ANILIST_KEYCHAIN_ACCOUNT,
      "-s",
      ANILIST_KEYCHAIN_SERVICE,
      "-w",
      clientSecret,
    ],
    {
      encoding: "utf8",
      maxBuffer: 4_096,
    },
  );
  return clientSecret;
}

async function promptForClientSecret(): Promise<string> {
  const promptScript = [
    'set promptResult to display dialog "Enter the client secret from AniList Developer Settings. It will be stored in macOS Keychain and is required only for this personal OAuth client." default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" with title "AniStream"',
    "text returned of promptResult",
  ];

  try {
    const args = promptScript.flatMap((line) => ["-e", line]);
    const { stdout } = await execFileAsync("/usr/bin/osascript", args, {
      encoding: "utf8",
      maxBuffer: 4_096,
    });
    const clientSecret = stdout.trim();
    if (clientSecret.length < 20 || clientSecret.length > 256) {
      throw new Error("The AniList client secret does not look valid.");
    }
    return clientSecret;
  } catch (error) {
    if (error instanceof Error && error.message === "The AniList client secret does not look valid.") {
      throw error;
    }
    throw new Error("AniList connection was cancelled before the client secret was saved.");
  }
}
