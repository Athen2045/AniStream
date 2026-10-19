import type { AnimeEpisodeArt } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

const BASE_URL = "https://api.ani.zip";
// One request carries every episode (One Piece is ~1.9 MB); a large title took 10.6 s in the trial.
const REQUEST_TIMEOUT_MS = 20_000;
// ani.zip publishes no rate limit or terms; this is a conservative application policy.
const REQUESTS_PER_MINUTE = 20;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const REFUSED_PAUSE_MS = 5 * 60_000;
const MAX_EPISODES = 2_000;
/** Episode screencaps ani.zip links to; any other image host is dropped. */
const IMAGE_HOSTS = new Set(["artworks.thetvdb.com"]);

type Fetcher = typeof fetch;

/** Where one AniList episode sits in time and in TheTVDB's season split. */
export interface AniZipEpisodeIndexRow {
  number: number;
  airDate?: string;
  /** TheTVDB season; absent for TheTVDB specials (season 0) and unplaced episodes. */
  tvdbSeason?: number;
  /** TheTVDB's runtime for this episode, in whole minutes. */
  runtimeMinutes?: number;
}

/** Everything AniStream keeps from one ani.zip title response. */
export interface AniZipTitle {
  art: AnimeEpisodeArt[];
  index: AniZipEpisodeIndexRow[];
  /** ani.zip's own TMDB mapping for the title, when it has one. */
  tmdbId?: number;
}

const EMPTY_TITLE: AniZipTitle = { art: [], index: [] };

const MAX_TITLE_LENGTH = 300;
const MAX_SYNOPSIS_LENGTH = 1_200;

/**
 * ani.zip community mapping (user-approved 2026-10-13): one request per AniList ID returns every
 * episode with a screencap, title, and synopsis. Identity is ani.zip's own `mappings.anilist_id`, which must equal
 * the requested ID; numbering is the entry-relative episode key (AniDB style, from 1), so episode N
 * maps to AniList episode N. Specials (`S1`, `C1`, ...) are ignored.
 */
export class AniZipClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
    windowMs: 60_000,
  });
  private readonly cache = createBoundedCache<AniZipTitle>({
    maxEntries: 100,
    ttlMs: CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly baseUrl = BASE_URL,
    fetcher: Fetcher = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": PROVIDER_USER_AGENT },
    });
  }

  /** Screencaps for AniList episodes 1..`episodes`; empty when ani.zip has no exact entry. */
  public async getEpisodeArt(aniListId: number, episodes: number): Promise<AnimeEpisodeArt[]> {
    const total = Math.min(Math.max(0, Math.floor(episodes)), MAX_EPISODES);
    return (await this.getTitle(aniListId)).art.filter((row) => row.number <= total);
  }

  /** The cached title response (one request serves art, episode index and TMDB mapping). */
  public async getTitle(aniListId: number): Promise<AniZipTitle> {
    if (!Number.isInteger(aniListId) || aniListId <= 0) {
      throw new Error("Invalid ani.zip episode-art lookup input.");
    }
    const key = String(aniListId);
    let title = this.cache.get(key);
    if (!title) {
      const url = new URL(`${this.baseUrl}/mappings`);
      url.searchParams.set("anilist_id", key);
      const payload = await this.transport.requestParsed(
        url,
        {
          dedupeKey: `anizip:${key}`,
          onResponse: (response, gate) => {
            if (response.status === 429 || response.status === 403) {
              gate.reportRateLimited(REFUSED_PAUSE_MS);
              throw new Error(`ani.zip temporarily refused requests (${response.status}).`);
            }
          },
        },
        async (response) => {
          // An unknown AniList ID answers 404; that is an empty result, not a failure.
          if (response.status === 404) return undefined;
          if (!response.ok) throw new Error(`ani.zip request failed (${response.status}).`);
          return response.json() as Promise<unknown>;
        },
      );
      title = parseAniZipTitle(payload, aniListId);
      this.cache.set(key, title);
    }
    return title;
  }
}

export function parseAniZipTitle(payload: unknown, aniListId: number): AniZipTitle {
  if (!isRecord(payload) || !isRecord(payload.mappings) || !isRecord(payload.episodes))
    return EMPTY_TITLE;
  if (payload.mappings.anilist_id !== aniListId) return EMPTY_TITLE;
  const index: AniZipEpisodeIndexRow[] = [];
  for (const [key, episode] of Object.entries(payload.episodes)) {
    if (!/^\d{1,4}$/.test(key) || !isRecord(episode)) continue;
    const number = Number(key);
    if (number < 1 || number > MAX_EPISODES) continue;
    const airDate = readDate(episode.airDate) ?? readDate(episode.airdate);
    const season = episode.seasonNumber;
    const tvdbSeason =
      typeof season === "number" && Number.isInteger(season) && season > 0 && season < 500
        ? season
        : undefined;
    const runtime = episode.runtime;
    const runtimeMinutes =
      typeof runtime === "number" && Number.isFinite(runtime) && runtime > 0 && runtime < 600
        ? runtime
        : undefined;
    index.push({
      number,
      ...(airDate ? { airDate } : {}),
      ...(tvdbSeason ? { tvdbSeason } : {}),
      ...(runtimeMinutes ? { runtimeMinutes } : {}),
    });
  }
  const tmdb = Number(payload.mappings.themoviedb_id);
  return {
    art: parseAniZipEpisodeArt(payload, aniListId),
    index: index.sort((a, b) => a.number - b.number),
    ...(Number.isInteger(tmdb) && tmdb > 0 ? { tmdbId: tmdb } : {}),
  };
}

export function parseAniZipEpisodeArt(payload: unknown, aniListId: number): AnimeEpisodeArt[] {
  if (!isRecord(payload) || !isRecord(payload.mappings) || !isRecord(payload.episodes)) return [];
  if (payload.mappings.anilist_id !== aniListId) return [];
  const art: AnimeEpisodeArt[] = [];
  for (const [key, episode] of Object.entries(payload.episodes)) {
    if (!/^\d{1,4}$/.test(key) || !isRecord(episode)) continue;
    const number = Number(key);
    if (number < 1 || number > MAX_EPISODES) continue;
    const stillUrl = readImageUrl(episode.image);
    const title = readTitle(episode.title);
    const synopsis = readSynopsis(episode.overview) ?? readSynopsis(episode.summary);
    if (!stillUrl && !title && !synopsis) continue;
    art.push({
      number,
      ...(stillUrl ? { stillUrl } : {}),
      ...(title ? { title } : {}),
      ...(synopsis ? { synopsis } : {}),
    });
  }
  return art.sort((a, b) => a.number - b.number);
}

/** English title, then romaji; AniDB writes apostrophes as backticks. */
function readTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const language of ["en", "x-jat"]) {
    const text = cleanText(value[language], MAX_TITLE_LENGTH);
    // AniDB's "Episode 12" placeholders add nothing over the episode number.
    if (text && !/^(episode|ep\.?)\s*\d+$/i.test(text)) return text;
  }
  return undefined;
}

/** TheTVDB overview, else the AniDB summary without its trailing "Source:"/"Note:" lines. */
function readSynopsis(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const body = value
    .split("\n")
    .filter((line) => !/^\s*(source|note)\s*:/i.test(line))
    .join("\n");
  return cleanText(body, MAX_SYNOPSIS_LENGTH);
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/`/g, "’").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function readDate(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function readImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname) && !url.username
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
