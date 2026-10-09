import type {
  MoreCastMember,
  MoreCatalogItem,
  MoreCatalogPage,
  MoreDetail,
  MoreEpisode,
  MoreMediaType,
  MoreSeason,
  MoreSeasonDetail,
} from "../shared/contracts";
import { moreGenreId, type MoreBrowseInput, type MoreSort } from "../shared/more-filters";
import type {
  RecommendationCreator,
  RecommendationItemFeatures,
  RecommendationTag,
} from "../shared/recommendations";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

// TMDB serves the same v3 API from both hosts. Some networks reset connections to the primary
// host, so a transport-level failure (never an HTTP status) retries once on the alternate host.
const TMDB_API_URL = "https://api.themoviedb.org/3/";
const TMDB_FALLBACK_API_URL = "https://api.tmdb.org/3/";
const FALLBACK_PREFERENCE_MS = 30 * 60_000;
const TMDB_IMAGE_URL = "https://image.tmdb.org/t/p";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_LIMIT = 20;

type Fetcher = typeof fetch;

export class TmdbClient {
  private readonly requestGate: RequestGate = createRequestGate({
    // Conservative application policy; TMDB documents that it rate-limits but does not
    // publish a stable numeric quota in the getting-started guide.
    requestsPerMinute: 30,
    windowMs: 60_000,
  });
  private readonly pageCache = createBoundedCache<MoreCatalogPage>({
    maxEntries: 40,
    ttlMs: 5 * 60_000,
  });
  private readonly detailCache = createBoundedCache<MoreDetail>({
    maxEntries: 80,
    ttlMs: 30 * 60_000,
  });
  private readonly seasonCache = createBoundedCache<MoreSeasonDetail>({
    maxEntries: 60,
    ttlMs: 30 * 60_000,
  });
  private readonly genreCache = createBoundedCache<Map<number, string>>({
    maxEntries: 2,
    ttlMs: 24 * 60 * 60_000,
  });
  private readonly transport: ProviderTransport;
  /** While set and in the future, requests start on the fallback host. */
  private preferFallbackUntil = 0;

  public constructor(
    private readonly accessToken = process.env.ANISTREAM_TMDB_ACCESS_TOKEN?.trim(),
    fetcher: Fetcher = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent": PROVIDER_USER_AGENT,
      },
    });
  }

  public async getTrending(type: MoreMediaType, page: number): Promise<MoreCatalogPage> {
    this.assertPage(page);
    const key = `trending:${type}:${page}`;
    const cached = this.pageCache.get(key);
    if (cached) return cached;
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const payload = await this.requestJson(`/trending/${mediaType}/week`, page);
    const result = parseCatalogPage(payload, type, page);
    this.pageCache.set(key, result);
    return result;
  }

  public async search(query: string, type: MoreMediaType, page: number): Promise<MoreCatalogPage> {
    this.assertPage(page);
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 100) {
      throw new Error("More search needs a title between 1 and 100 characters.");
    }
    const key = `search:${type}:${page}:${normalizedQuery.toLocaleLowerCase()}`;
    const cached = this.pageCache.get(key);
    if (cached) return cached;
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const payload = await this.requestJson(`/search/${mediaType}`, page, {
      query: normalizedQuery,
      include_adult: "false",
    });
    const result = parseCatalogPage(payload, type, page);
    this.pageCache.set(key, result);
    return result;
  }

  /**
   * Filtered browsing for More search. Without a title it is one `/discover` page; with a title
   * TMDB search cannot filter, so the search page is narrowed here by the same fields.
   */
  public async browse(input: MoreBrowseInput): Promise<MoreCatalogPage> {
    this.assertPage(input.page);
    const { type, page } = input;
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const genreId = input.genre ? moreGenreId(input.genre, type) : undefined;
    const empty: MoreCatalogPage = {
      pageInfo: { currentPage: page, totalPages: page, totalResults: 0, hasNextPage: false },
      items: [],
    };
    if (input.genre && genreId === undefined) return empty;
    const query = input.query?.trim();
    const key = `browse:${JSON.stringify({ ...input, query: query?.toLocaleLowerCase() })}`;
    const cached = this.pageCache.get(key);
    if (cached) return cached;
    let result: MoreCatalogPage;
    if (query) {
      const dateField = type === "MOVIE" ? "release_date" : "first_air_date";
      const matches = (row: unknown): boolean =>
        isRecord(row) &&
        (genreId === undefined ||
          (Array.isArray(row.genre_ids) && row.genre_ids.includes(genreId))) &&
        (!input.language || row.original_language === input.language) &&
        (input.year === undefined ||
          (typeof row[dateField] === "string" &&
            (row[dateField] as string).startsWith(String(input.year)))) &&
        (input.minScore === undefined ||
          (typeof row.vote_average === "number" &&
            row.vote_average >= input.minScore &&
            typeof row.vote_count === "number" &&
            row.vote_count >= MIN_FILTER_VOTES));
      // Filters can leave little of one search page, so a few pages are read until enough match.
      const kept: unknown[] = [];
      const seen = new Set<unknown>();
      let payload: Record<string, unknown> = {};
      let last = page;
      for (let current = page; current < page + MAX_FILTERED_SEARCH_PAGES; current += 1) {
        const response = await this.requestJson(`/search/${mediaType}`, current, {
          query,
          include_adult: "false",
        });
        if (!isRecord(response) || !Array.isArray(response.results))
          throw new Error("TMDB returned an invalid catalog response.");
        payload = response;
        last = current;
        for (const row of response.results)
          if (matches(row) && isRecord(row) && !seen.has(row.id)) {
            seen.add(row.id);
            kept.push(row);
          }
        const totalPages =
          typeof response.total_pages === "number" ? response.total_pages : current;
        if (kept.length >= FILTERED_SEARCH_TARGET || current >= totalPages) break;
      }
      result = parseCatalogPage({ ...payload, results: kept }, type, last);
      result.items = sortCatalog(result.items, input.sort, kept);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const params: Record<string, string> = {
        include_adult: "false",
        sort_by:
          input.sort === "rated"
            ? "vote_average.desc"
            : input.sort === "newest"
              ? type === "MOVIE"
                ? "primary_release_date.desc"
                : "first_air_date.desc"
              : "popularity.desc",
      };
      if (genreId !== undefined) params.with_genres = String(genreId);
      if (input.language) params.with_original_language = input.language;
      if (input.year !== undefined)
        params[type === "MOVIE" ? "primary_release_year" : "first_air_date_year"] = String(
          input.year,
        );
      if (input.minScore !== undefined) params["vote_average.gte"] = String(input.minScore);
      // Ratings from a handful of votes are noise; "newest" means already released.
      if (input.minScore !== undefined || input.sort === "rated")
        params["vote_count.gte"] = String(
          input.sort === "rated" ? RATED_SORT_VOTES : MIN_FILTER_VOTES,
        );
      if (input.sort === "newest")
        params[type === "MOVIE" ? "primary_release_date.lte" : "first_air_date.lte"] = today;
      result = parseCatalogPage(
        await this.requestJson(`/discover/${mediaType}`, page, params),
        type,
        page,
      );
    }
    this.pageCache.set(key, result);
    return result;
  }

  public async getDetail(id: number, type: MoreMediaType): Promise<MoreDetail> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid TMDB media ID.");
    const key = `detail:${type}:${id}`;
    const cached = this.detailCache.get(key);
    if (cached) return cached;
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const payload = await this.requestJson(`/${mediaType}/${id}`, undefined, {
      append_to_response:
        type === "MOVIE"
          ? "images,release_dates,credits,recommendations"
          : "images,content_ratings,aggregate_credits,recommendations",
      // Logos are language-tagged; "null" admits textless art when no English logo exists.
      include_image_language: "en,null",
    });
    const result = parseDetail(payload, type);
    this.detailCache.set(key, result);
    return result;
  }

  /**
   * One request per seed: title features (genres, keywords, directors/creators, lead cast) plus
   * TMDB's own recommendations as rank-weighted edges with inline neighbor features.
   */
  public async getRecommendationSeed(
    id: number,
    type: MoreMediaType,
  ): Promise<MoreRecommendationSeed> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid TMDB media ID.");
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const [genres, payload] = await Promise.all([
      this.genreNames(type),
      this.requestJson(`/${mediaType}/${id}`, undefined, {
        append_to_response: "keywords,credits,recommendations",
      }),
    ]);
    return parseRecommendationSeed(payload, type, genres, Date.now());
  }

  /**
   * Well-known titles in one original language (most votes first), so viewers of, say, Malayalam
   * films have same-language candidates even though the weekly trending lists rarely carry them.
   */
  public async getRecommendationsByLanguage(
    type: MoreMediaType,
    language: string,
  ): Promise<RecommendationItemFeatures[]> {
    if (!/^[a-z]{2,3}$/.test(language)) throw new Error("Invalid TMDB language.");
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const [genres, payload] = await Promise.all([
      this.genreNames(type),
      this.requestJson(`/discover/${mediaType}`, 1, {
        with_original_language: language,
        sort_by: "vote_count.desc",
        include_adult: "false",
      }),
    ]);
    if (!isRecord(payload) || !Array.isArray(payload.results))
      throw new Error("TMDB returned an invalid discover response.");
    const now = Date.now();
    return payload.results
      .slice(0, PAGE_LIMIT)
      .flatMap((value) => candidateFeatures(value, type, genres, now) ?? []);
  }

  /**
   * Well-known titles carrying one TMDB keyword, tagged with it, for a "Because you like <theme>"
   * row (list rows carry no keywords of their own).
   */
  public async getRecommendationsByKeyword(
    type: MoreMediaType,
    keyword: { id: number; name: string },
  ): Promise<RecommendationItemFeatures[]> {
    if (!Number.isInteger(keyword.id) || keyword.id <= 0) throw new Error("Invalid TMDB keyword.");
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const [genres, payload] = await Promise.all([
      this.genreNames(type),
      this.requestJson(`/discover/${mediaType}`, 1, {
        with_keywords: String(keyword.id),
        sort_by: "vote_count.desc",
        include_adult: "false",
      }),
    ]);
    if (!isRecord(payload) || !Array.isArray(payload.results))
      throw new Error("TMDB returned an invalid discover response.");
    const now = Date.now();
    const tag = { id: keyword.id, name: keyword.name, rank: KEYWORD_RANK };
    return payload.results.slice(0, PAGE_LIMIT).flatMap((value) => {
      const features = candidateFeatures(value, type, genres, now);
      return features ? [{ ...features, tags: [tag] }] : [];
    });
  }

  /** Trending titles of the week as recommendation candidates (genre names resolved). */
  public async getRecommendationTrending(
    type: MoreMediaType,
  ): Promise<RecommendationItemFeatures[]> {
    const mediaType = type === "MOVIE" ? "movie" : "tv";
    const [genres, payload] = await Promise.all([
      this.genreNames(type),
      this.requestJson(`/trending/${mediaType}/week`, 1),
    ]);
    if (!isRecord(payload) || !Array.isArray(payload.results))
      throw new Error("TMDB returned an invalid trending response.");
    const now = Date.now();
    return payload.results
      .slice(0, PAGE_LIMIT)
      .flatMap((value) => candidateFeatures(value, type, genres, now) ?? []);
  }

  private async genreNames(type: MoreMediaType): Promise<Map<number, string>> {
    const cached = this.genreCache.get(type);
    if (cached) return cached;
    const payload = await this.requestJson(`/genre/${type === "MOVIE" ? "movie" : "tv"}/list`);
    const genres = new Map<number, string>();
    if (isRecord(payload) && Array.isArray(payload.genres))
      for (const genre of payload.genres.slice(0, 100))
        if (isRecord(genre) && typeof genre.id === "number") {
          const name = readString(genre.name, 60);
          if (name) genres.set(genre.id, name);
        }
    this.genreCache.set(type, genres);
    return genres;
  }

  public async getSeason(id: number, seasonNumber: number): Promise<MoreSeasonDetail> {
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid TMDB media ID.");
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 500)
      throw new Error("Invalid TMDB season number.");
    const key = `season:${id}:${seasonNumber}`;
    const cached = this.seasonCache.get(key);
    if (cached) return cached;
    const payload = await this.requestJson(`/tv/${id}/season/${seasonNumber}`);
    const result = parseSeason(payload, seasonNumber);
    this.seasonCache.set(key, result);
    return result;
  }

  private async requestJson(
    path: string,
    page?: number,
    query: Record<string, string> = {},
  ): Promise<unknown> {
    if (!this.accessToken) {
      throw new Error(
        "TMDB is not configured. Add ANISTREAM_TMDB_ACCESS_TOKEN to the main process environment.",
      );
    }
    const usePrimaryFirst = Date.now() >= this.preferFallbackUntil;
    const [first, second] = usePrimaryFirst
      ? [TMDB_API_URL, TMDB_FALLBACK_API_URL]
      : [TMDB_FALLBACK_API_URL, TMDB_API_URL];
    try {
      return await this.requestFrom(first, path, page, query);
    } catch (error) {
      if (!isTransportFailure(error)) throw error;
      const result = await this.requestFrom(second, path, page, query).catch(() => {
        throw error;
      });
      this.preferFallbackUntil = usePrimaryFirst ? Date.now() + FALLBACK_PREFERENCE_MS : 0;
      return result;
    }
  }

  private requestFrom(
    baseUrl: string,
    path: string,
    page: number | undefined,
    query: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);
    if (page !== undefined) url.searchParams.set("page", String(page));
    url.searchParams.set("language", "en-US");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return this.transport.requestParsed(
      url,
      {
        dedupeKey: url.toString(),
        headers: { Authorization: `Bearer ${this.accessToken}` },
        onResponse: (response, gate) => {
          if (response.status === 429 || response.status === 403) {
            gate.reportRateLimited(5 * 60_000);
            throw new TmdbResponseError(`TMDB temporarily refused requests (${response.status}).`);
          }
        },
      },
      (response) => {
        if (!response.ok) throw new TmdbResponseError(`TMDB request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      },
    );
  }

  private assertPage(page: number): void {
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error("Invalid TMDB page.");
  }
}

export interface MoreRecommendationSeed {
  seed: RecommendationItemFeatures;
  neighbors: RecommendationItemFeatures[];
}

const SEED_EDGE_LIMIT = 15;
const KEYWORD_LIMIT = 20;
/** TMDB keywords are unranked; give them a strong but below-maximum tag weight. */
const KEYWORD_RANK = 70;
const LEAD_CAST = 3;
/** Big productions list hundreds of crew; the director can appear late in TMDB order. */
const MAX_CREW_SCAN = 3_000;

/**
 * TMDB genre names mapped onto the AniList genre vocabulary so anime/manga taste can act as a
 * prior for More. Unmapped names (Crime, Documentary, Family, …) stay as they are.
 */
const GENRE_ALIASES: Record<string, string[]> = {
  "Science Fiction": ["Sci-Fi"],
  "Action & Adventure": ["Action", "Adventure"],
  "Sci-Fi & Fantasy": ["Sci-Fi", "Fantasy"],
  "War & Politics": ["War", "Politics"],
};

export function sharedGenres(names: string[]): string[] {
  return [...new Set(names.flatMap((name) => GENRE_ALIASES[name] ?? [name]))];
}

function parseRecommendationSeed(
  value: unknown,
  type: MoreMediaType,
  genreNames: Map<number, string>,
  now: number,
): MoreRecommendationSeed {
  const seed = candidateFeatures(value, type, genreNames, now);
  if (!seed || !isRecord(value)) throw new Error("TMDB returned an invalid title detail.");
  if (Array.isArray(value.genres))
    seed.genres = sharedGenres(
      value.genres.flatMap((genre) =>
        isRecord(genre) && readString(genre.name, 60) ? [readString(genre.name, 60)!] : [],
      ),
    );
  const keywords = isRecord(value.keywords)
    ? type === "MOVIE"
      ? value.keywords.keywords
      : value.keywords.results
    : undefined;
  seed.tags = (Array.isArray(keywords) ? keywords : [])
    .slice(0, KEYWORD_LIMIT)
    .flatMap((keyword): RecommendationTag[] => {
      const name = isRecord(keyword) ? readString(keyword.name, 80) : undefined;
      return isRecord(keyword) && typeof keyword.id === "number" && name
        ? [{ id: keyword.id, name, rank: KEYWORD_RANK }]
        : [];
    });
  seed.creators = seedCreators(value, type);
  // TMDB's own "no language" code, so a hydrated seed is never mistaken for a pre-origin cache row.
  seed.origin ??= "xx";
  const results = isRecord(value.recommendations) ? value.recommendations.results : undefined;
  const neighbors = (Array.isArray(results) ? results : [])
    .slice(0, SEED_EDGE_LIMIT)
    .flatMap((row) => candidateFeatures(row, type, genreNames, now) ?? [])
    .filter((row) => row.anilistId !== seed.anilistId);
  // TMDB orders recommendations without a public score, so edges are weighted by rank.
  seed.recommendations = neighbors.map((row, index) => ({
    id: row.anilistId,
    mediaType: type,
    rating: SEED_EDGE_LIMIT - index,
  }));
  return { seed, neighbors };
}

function seedCreators(
  value: Record<string, unknown>,
  type: MoreMediaType,
): RecommendationCreator[] {
  const people: RecommendationCreator[] = [];
  const person = (entry: unknown): RecommendationCreator | undefined => {
    if (!isRecord(entry) || typeof entry.id !== "number") return undefined;
    const name = readString(entry.name, 200);
    return name ? { id: entry.id, name, role: "PERSON" } : undefined;
  };
  if (type === "TV" && Array.isArray(value.created_by))
    for (const entry of value.created_by.slice(0, 4)) {
      const creator = person(entry);
      if (creator) people.push(creator);
    }
  const credits = isRecord(value.credits) ? value.credits : undefined;
  if (type === "MOVIE" && Array.isArray(credits?.crew))
    for (const entry of credits.crew.slice(0, MAX_CREW_SCAN))
      if (isRecord(entry) && entry.job === "Director") {
        const creator = person(entry);
        if (creator) people.push(creator);
      }
  if (Array.isArray(credits?.cast))
    for (const entry of credits.cast.slice(0, LEAD_CAST)) {
      const creator = person(entry);
      if (creator) people.push(creator);
    }
  const seen = new Set<number>();
  return people.filter((creator) => !seen.has(creator.id!) && Boolean(seen.add(creator.id!)));
}

/** Candidate-level features from a TMDB list row or detail (no keywords or credits). */
function candidateFeatures(
  value: unknown,
  type: MoreMediaType,
  genreNames: Map<number, string>,
  now: number,
): RecommendationItemFeatures | undefined {
  const item = parseCatalogItem(value, type);
  if (!item || !isRecord(value)) return undefined;
  const ids = Array.isArray(value.genre_ids) ? value.genre_ids : [];
  return {
    anilistId: item.id,
    mediaType: type,
    normalizedTitle: item.title,
    coverUrl: item.posterUrl,
    backdropUrl: item.backdropUrl,
    releaseDate: item.releaseDate,
    titleTokens: [],
    synonyms: [],
    genres: sharedGenres(
      ids.flatMap((id) =>
        typeof id === "number" && genreNames.has(id) ? [genreNames.get(id)!] : [],
      ),
    ),
    tags: [],
    creators: [],
    averageScore: item.score === undefined ? undefined : Math.round(item.score * 10),
    // Vote count is the stable audience-size signal; TMDB "popularity" is a volatile trend score.
    popularity: item.voteCount,
    isAdult: value.adult === true,
    origin: readLanguage(value.original_language),
    updatedAt: now,
  };
}

/** TMDB answered; the host is reachable, so another host would not help. */
class TmdbResponseError extends Error {}

/** Connection resets, DNS failures, and timeouts; not HTTP statuses, bodies, or rate limits. */
function isTransportFailure(error: unknown): boolean {
  if (error instanceof TmdbResponseError || error instanceof SyntaxError) return false;
  return true;
}

/** Votes a rating needs before score filters trust it; "Highest rated" asks for more. */
const MIN_FILTER_VOTES = 50;
/** Title search with filters reads up to this many pages to reach the target matches. */
const MAX_FILTERED_SEARCH_PAGES = 3;
const FILTERED_SEARCH_TARGET = 12;
const RATED_SORT_VOTES = 300;

/** Orders filtered search results like discover would: popularity, rating, or newest first. */
function sortCatalog(items: MoreCatalogItem[], sort: MoreSort, raw: unknown[]): MoreCatalogItem[] {
  if (sort === "popular") {
    const popularity = new Map(
      raw.flatMap((row) =>
        isRecord(row) && typeof row.id === "number" && typeof row.popularity === "number"
          ? [[row.id, row.popularity] as const]
          : [],
      ),
    );
    return [...items].sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0));
  }
  if (sort === "rated") return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [...items].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
}

function parseCatalogPage(payload: unknown, type: MoreMediaType, page: number): MoreCatalogPage {
  if (!isRecord(payload) || !Array.isArray(payload.results))
    throw new Error("TMDB returned an invalid catalog response.");
  const items = payload.results.flatMap((item): MoreCatalogItem[] => {
    const normalized = parseCatalogItem(item, type);
    return normalized ? [normalized] : [];
  });
  const totalPages = boundedInteger(payload.total_pages, page, 500);
  const totalResults = boundedInteger(payload.total_results, items.length, 100_000_000);
  return {
    pageInfo: { currentPage: page, totalPages, totalResults, hasNextPage: page < totalPages },
    items: items.slice(0, PAGE_LIMIT),
  };
}

function parseCatalogItem(value: unknown, type: MoreMediaType): MoreCatalogItem | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    !Number.isInteger(value.id) ||
    value.id <= 0
  )
    return undefined;
  const id = value.id;
  const titleValue = type === "MOVIE" ? value.title : value.name;
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  if (!title || title.length > 300) return undefined;
  const releaseDate = readDate(type === "MOVIE" ? value.release_date : value.first_air_date);
  return {
    id,
    type,
    title,
    originalTitle: readString(type === "MOVIE" ? value.original_title : value.original_name, 300),
    overview: readString(value.overview, 4_000),
    posterUrl: imageUrl(value.poster_path, "w500"),
    backdropUrl: imageUrl(value.backdrop_path, "w1280"),
    releaseDate,
    year: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined,
    score: boundedNumber(value.vote_average, 0, 10),
    voteCount: boundedInteger(value.vote_count, 0, 100_000_000),
    genres: [],
    siteUrl: `https://www.themoviedb.org/${type === "MOVIE" ? "movie" : "tv"}/${id}`,
  };
}

function parseDetail(value: unknown, type: MoreMediaType): MoreDetail {
  const record = isRecord(value) ? value : undefined;
  const item = parseCatalogItem(record, type);
  if (!item) throw new Error("TMDB returned an invalid title detail.");
  const genres = Array.isArray(record?.genres)
    ? record.genres.flatMap((genre: unknown): string[] => {
        if (!isRecord(genre) || typeof genre.name !== "string") return [];
        const name = genre.name.trim();
        return name ? [name] : [];
      })
    : [];
  const seasons =
    type === "TV" && Array.isArray(record?.seasons)
      ? record.seasons.flatMap((season: unknown): MoreSeason[] => {
          if (
            !isRecord(season) ||
            typeof season.season_number !== "number" ||
            !Number.isInteger(season.season_number) ||
            season.season_number < 0
          )
            return [];
          const seasonNumber = season.season_number;
          return [
            {
              number: seasonNumber,
              name: readString(season.name, 200) ?? `Season ${seasonNumber}`,
              episodeCount: boundedInteger(season.episode_count, 0, 10_000),
              overview: readString(season.overview, 4_000),
              posterUrl: imageUrl(season.poster_path, "w500"),
              airDate: readDate(season.air_date),
            },
          ];
        })
      : [];
  const runtime =
    type === "MOVIE"
      ? boundedInteger(record?.runtime, 0, 2_000)
      : Array.isArray(record?.episode_run_time) && typeof record.episode_run_time[0] === "number"
        ? boundedInteger(record.episode_run_time[0], 0, 300)
        : undefined;
  const networks = Array.isArray(record?.networks)
    ? record.networks.flatMap((network: unknown): string[] => {
        if (!isRecord(network) || typeof network.name !== "string") return [];
        const name = network.name.trim();
        return name ? [name] : [];
      })
    : [];
  const brand = readBrand(type === "TV" ? record?.networks : record?.production_companies);
  const creators =
    type === "TV" && Array.isArray(record?.created_by)
      ? record.created_by.flatMap((creator: unknown): string[] => {
          const name = isRecord(creator) ? readString(creator.name, 200) : undefined;
          return name ? [name] : [];
        })
      : [];
  return {
    ...item,
    genres,
    runtimeMinutes: runtime,
    numberOfSeasons: boundedInteger(record?.number_of_seasons, 0, 500),
    numberOfEpisodes: boundedInteger(record?.number_of_episodes, 0, 100_000),
    seasons,
    status: readString(record?.status, 100),
    networks,
    creators: creators.slice(0, 6),
    logoUrl: readLogo(record?.images),
    heroBackdropUrl: imageUrl(record?.backdrop_path, "original"),
    certification: type === "TV" ? readTvRating(record) : readMovieRating(record),
    originalLanguage: readLanguage(record?.original_language),
    lastAirDate: type === "TV" ? readDate(record?.last_air_date) : undefined,
    brandName: brand?.name,
    brandLogoUrl: brand?.logoUrl,
    cast: readCast(type === "TV" ? record?.aggregate_credits : record?.credits),
    recommendations: readRecommendations(record?.recommendations, type),
  };
}

/** Lead cast shown on the title page. */
const CAST_LIMIT = 8;
/**
 * Picks with fewer TMDB votes than this are left out of "More like this" (user decision
 * 2026-10-06): low-vote picks were often loosely related.
 */
export const MIN_RECOMMENDATION_VOTES = 100;

function readCast(value: unknown): MoreCastMember[] {
  if (!isRecord(value) || !Array.isArray(value.cast)) return [];
  return value.cast
    .flatMap((member: unknown): MoreCastMember[] => {
      if (!isRecord(member)) return [];
      const name = readString(member.name, 200);
      if (!name) return [];
      // Movies name one character; shows list roles across seasons (aggregate credits).
      const character =
        readString(member.character, 200) ??
        (Array.isArray(member.roles) && isRecord(member.roles[0])
          ? readString(member.roles[0].character, 200)
          : undefined);
      return [{ name, character, profileUrl: imageUrl(member.profile_path, "w185") }];
    })
    .slice(0, CAST_LIMIT);
}

function readRecommendations(value: unknown, type: MoreMediaType): MoreCatalogItem[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results
    .flatMap((result: unknown): MoreCatalogItem[] => {
      // Recommendations of a show are shows and of a movie are movies.
      const item = parseCatalogItem(result, type);
      return item && (item.voteCount ?? 0) >= MIN_RECOMMENDATION_VOTES && item.posterUrl
        ? [item]
        : [];
    })
    .slice(0, 20);
}

function parseSeason(value: unknown, seasonNumber: number): MoreSeasonDetail {
  if (!isRecord(value) || !Array.isArray(value.episodes))
    throw new Error("TMDB returned an invalid season response.");
  const episodes = value.episodes.flatMap((episode: unknown): MoreEpisode[] => {
    if (
      !isRecord(episode) ||
      typeof episode.episode_number !== "number" ||
      !Number.isInteger(episode.episode_number) ||
      episode.episode_number <= 0 ||
      episode.episode_number > 10_000
    )
      return [];
    const number = episode.episode_number;
    const runtime = boundedInteger(episode.runtime, 0, 1_000);
    return [
      {
        number,
        name: readString(episode.name, 300) ?? `Episode ${number}`,
        overview: readString(episode.overview, 4_000),
        stillUrl: imageUrl(episode.still_path, "w780"),
        runtimeMinutes: runtime > 0 ? runtime : undefined,
        airDate: readDate(episode.air_date),
        score: boundedNumber(episode.vote_average, 0, 10),
      },
    ];
  });
  return {
    seasonNumber,
    name: readString(value.name, 200) ?? `Season ${seasonNumber}`,
    episodes: episodes.slice(0, 1_000),
  };
}

function readLogo(images: unknown): string | undefined {
  if (!isRecord(images) || !Array.isArray(images.logos)) return undefined;
  const logos = images.logos.filter(isRecord);
  const english = logos.find((logo) => logo.iso_639_1 === "en" && imageUrl(logo.file_path, "w500"));
  const neutral = logos.find((logo) => logo.iso_639_1 == null && imageUrl(logo.file_path, "w500"));
  return imageUrl((english ?? neutral)?.file_path, "w500");
}

function readTvRating(record: Record<string, unknown> | undefined): string | undefined {
  const ratings = isRecord(record?.content_ratings) ? record.content_ratings.results : undefined;
  if (!Array.isArray(ratings)) return undefined;
  const us = ratings.find((rating) => isRecord(rating) && rating.iso_3166_1 === "US");
  return isRecord(us) ? readCertification(us.rating) : undefined;
}

function readMovieRating(record: Record<string, unknown> | undefined): string | undefined {
  const releases = isRecord(record?.release_dates) ? record.release_dates.results : undefined;
  if (!Array.isArray(releases)) return undefined;
  const us = releases.find((release) => isRecord(release) && release.iso_3166_1 === "US");
  if (!isRecord(us) || !Array.isArray(us.release_dates)) return undefined;
  for (const release of us.release_dates) {
    const certification = isRecord(release) ? readCertification(release.certification) : undefined;
    if (certification) return certification;
  }
  return undefined;
}

function readCertification(value: unknown): string | undefined {
  const text = readString(value, 12);
  return text && /^[A-Za-z0-9+-]+(?: [A-Za-z0-9+-]+)?$/.test(text) ? text : undefined;
}

function readLanguage(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z]{2,3}$/.test(value) ? value : undefined;
}

function readBrand(value: unknown): { name: string; logoUrl?: string } | undefined {
  if (!Array.isArray(value)) return undefined;
  const brands = value.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const name = readString(entry.name, 120);
    return name ? [{ name, logoUrl: imageUrl(entry.logo_path, "w300") }] : [];
  });
  return brands.find((brand) => brand.logoUrl) ?? brands[0];
}

type ImageSize = "w185" | "w300" | "w500" | "w780" | "w1280" | "original";

function imageUrl(value: unknown, size: ImageSize): string | undefined {
  if (typeof value !== "string" || !/^\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,239}$/.test(value))
    return undefined;
  return `${TMDB_IMAGE_URL}/${size}${value}`;
}

function readString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= maxLength ? result : undefined;
}

function readDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
