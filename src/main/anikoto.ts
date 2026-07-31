import type {
  AnimeEpisodeCatalog,
  AnimeEpisodeCatalogInput,
  AnimePlaybackCandidate,
  AnimePlaybackInput,
  AnimePlaybackResult,
  AnimeProviderEpisode,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const DEFAULT_API_BASE_URL = "https://anikotoapi.site";
const MEGAPLAY_ORIGIN = "https://megaplay.buzz";
const RECENT_CACHE_MS = 15 * 60 * 1_000;
const SERIES_CACHE_MS = 30 * 60 * 1_000;
const REQUEST_INTERVAL_MS = 2_100;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 120_000;
const FORBIDDEN_COOLDOWN_MS = 10 * 60 * 1_000;
const MAX_EPISODES = 2_000;

interface RecentSeries {
  id: number;
  aniListId: number;
  title: string;
}

export class AnikotoClient {
  private readonly recent = createBoundedCache<unknown>({
    maxEntries: 1,
    ttlMs: RECENT_CACHE_MS,
  });
  private readonly series = createBoundedCache<unknown>({
    maxEntries: 100,
    ttlMs: SERIES_CACHE_MS,
  });
  // Anikoto documents a strict minimum gap between requests rather than a per-minute
  // budget, so the shared gate is used purely for its dedupe + pacing primitives.
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: Number.POSITIVE_INFINITY,
    minIntervalMs: REQUEST_INTERVAL_MS,
  });
  private readonly apiBaseUrl: URL;

  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    apiBaseUrl = process.env.ANISTREAM_ANIKOTO_API_URL ?? DEFAULT_API_BASE_URL,
  ) {
    this.apiBaseUrl = validateApiBaseUrl(apiBaseUrl);
  }

  public async getEpisodeCatalog(input: AnimeEpisodeCatalogInput): Promise<AnimeEpisodeCatalog> {
    const fallback = createAniListCatalog(input);

    try {
      const match = await this.findRecentSeries(input.aniListId);
      if (!match) {
        return {
          ...fallback,
          message:
            "Anikoto does not publish a full-catalog search endpoint. Episode numbers come from AniList; playback uses Anikoto's documented AniList-ID embed route.",
        };
      }

      const payload = await this.getSeries(match.id);
      const catalog = parseAnikotoSeriesCatalog(payload, input);
      if (catalog.status === "available") return catalog;

      return {
        ...fallback,
        providerTitle: match.title,
        message:
          "Anikoto matched this AniList title but returned no valid episode rows. AniStream is using AniList episode numbers with Anikoto's direct AniList-ID player route.",
      };
    } catch (reason) {
      return {
        ...fallback,
        message: `${messageFrom(reason, "Anikoto episode details are unavailable.")} AniStream is using AniList episode numbers with Anikoto's direct AniList-ID player route.`,
      };
    }
  }

  public async getPlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult> {
    validatePlaybackInput(input);

    const requestedAudio = input.audio ?? "sub";
    const audioOptions =
      requestedAudio === "sub" ? (["sub", "dub"] as const) : (["dub", "sub"] as const);
    const embedId = parseProviderEpisodeId(input.providerEpisodeId);
    const candidates = audioOptions.map((audio) => createEmbedCandidate(input, audio, embedId));

    return {
      status: "available",
      candidates,
      attemptedSources: ["anikoto", "megaplay"],
    };
  }

  private async findRecentSeries(aniListId: number): Promise<RecentSeries | undefined> {
    const cacheKey = "recent";
    let recent = this.recent.get(cacheKey);
    if (!recent) {
      const url = new URL("/recent-anime", this.apiBaseUrl);
      url.searchParams.set("page", "1");
      url.searchParams.set("per_page", "100");
      recent = await this.requestJson(url);
      this.recent.set(cacheKey, recent);
    }
    return findExactRecentAniListSeries(recent, aniListId);
  }

  private async getSeries(seriesId: number): Promise<unknown> {
    const cacheKey = String(seriesId);
    const cached = this.series.get(cacheKey);
    if (cached) return cached;

    const value = await this.requestJson(new URL(`/series/${seriesId}`, this.apiBaseUrl));
    this.series.set(cacheKey, value);
    return value;
  }

  private async requestJson(url: URL): Promise<unknown> {
    return this.requestGate.run(url.toString(), async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "AniStream/0.1 (personal macOS application)",
          },
          redirect: "error",
          signal: controller.signal,
        });

        if (response.status === 429) {
          this.requestGate.reportRateLimited(
            parseProviderCooldown(response, DEFAULT_RATE_LIMIT_COOLDOWN_MS),
          );
          throw new Error("Anikoto rate limit reached. Try again after its cooldown.");
        }
        if (response.status === 403) {
          this.requestGate.reportRateLimited(FORBIDDEN_COOLDOWN_MS);
          throw new Error(
            "Anikoto temporarily blocked this IP. AniStream paused provider requests.",
          );
        }
        if (!response.ok) throw new Error(`Anikoto returned HTTP ${response.status}.`);

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

export function findExactRecentAniListSeries(
  payload: unknown,
  aniListId: number,
): RecentSeries | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;

  const matches = payload.data.flatMap((item): RecentSeries[] => {
    if (!isRecord(item)) return [];
    const itemAniListId = positiveInteger(item.ani_id);
    const id = positiveInteger(item.id);
    const title = cleanString(item.title);
    if (itemAniListId !== aniListId || !id || !title) return [];
    return [{ id, aniListId: itemAniListId, title }];
  });

  return matches.length === 1 ? matches[0] : undefined;
}

export function parseAnikotoSeriesCatalog(
  payload: unknown,
  input: AnimeEpisodeCatalogInput,
): AnimeEpisodeCatalog {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) {
    return unavailableCatalog("Anikoto returned an invalid series payload.");
  }

  const anime = payload.data.anime;
  const episodes = payload.data.episodes;
  if (
    !isRecord(anime) ||
    positiveInteger(anime.ani_id) !== input.aniListId ||
    !Array.isArray(episodes)
  ) {
    return unavailableCatalog("Anikoto series identity did not match the requested AniList ID.");
  }

  const thumbnailUrl = safeHttpsUrl(anime.background_image) ?? safeHttpsUrl(anime.poster);
  const normalized = episodes
    .flatMap((episode): AnimeProviderEpisode[] => {
      if (!isRecord(episode)) return [];
      const number = positiveInteger(episode.number);
      const embedId = cleanString(episode.episode_embed_id);
      if (!number || number > MAX_EPISODES || !embedId || !/^\d+$/.test(embedId)) return [];

      return [
        {
          id: `anikoto:${embedId}`,
          number,
          title: cleanString(episode.title) ?? `Episode ${number}`,
          thumbnailUrl:
            safeHttpsUrl(episode.thumbnail_url) ??
            safeHttpsUrl(episode.thumbnail) ??
            safeHttpsUrl(episode.image) ??
            thumbnailUrl ??
            input.fallbackThumbnailUrl,
          description:
            cleanString(episode.description) ??
            cleanString(episode.synopsis) ??
            input.fallbackDescription,
        },
      ];
    })
    .sort((left, right) => left.number - right.number)
    .filter((episode, index, all) => index === 0 || episode.number !== all[index - 1]?.number);

  if (!normalized.length) return unavailableCatalog("Anikoto returned no valid episodes.");

  return {
    status: "available",
    provider: "anikoto",
    providerTitle: cleanString(anime.title),
    seasons: [
      {
        id: `anikoto:${input.aniListId}:season:1`,
        number: 1,
        title: input.seasonLabel ?? "Season 1",
        episodes: normalized,
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

function createAniListCatalog(input: AnimeEpisodeCatalogInput): AnimeEpisodeCatalog {
  const count = Math.min(Math.max(input.totalEpisodes ?? 1, 1), MAX_EPISODES);
  return {
    status: "available",
    provider: "anikoto",
    providerTitle: input.titles[0],
    seasons: [
      {
        id: `anilist:${input.aniListId}:season:1`,
        number: 1,
        title: input.seasonLabel ?? "Season 1",
        episodes: Array.from({ length: count }, (_, index) => ({
          id: `anilist:${input.aniListId}:episode:${index + 1}`,
          number: index + 1,
          title: `Episode ${index + 1}`,
          thumbnailUrl: input.fallbackThumbnailUrl,
          description: input.fallbackDescription,
        })),
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

function unavailableCatalog(message: string): AnimeEpisodeCatalog {
  return {
    status: "unavailable",
    provider: "anikoto",
    seasons: [],
    message,
    checkedAt: new Date().toISOString(),
  };
}

function createEmbedCandidate(
  input: AnimePlaybackInput,
  audio: "sub" | "dub",
  embedId?: string,
): AnimePlaybackCandidate {
  const path = embedId
    ? `/stream/s-2/${embedId}/${audio}`
    : `/stream/ani/${input.aniListId}/${input.episode}/${audio}`;

  return {
    id: `anikoto:${input.aniListId}:${input.episode}:${audio}`,
    label: audio === "sub" ? "Japanese · subtitles" : "English dub",
    kind: "embed",
    url: new URL(path, MEGAPLAY_ORIGIN).toString(),
    language: audio,
    provider: "anikoto",
  };
}

function parseProviderEpisodeId(value?: string): string | undefined {
  if (!value) return undefined;
  return /^anikoto:(\d+)$/.exec(value)?.[1];
}

function validatePlaybackInput(input: AnimePlaybackInput): void {
  if (!Number.isSafeInteger(input.aniListId) || input.aniListId <= 0) {
    throw new Error("AniList ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.episode) || input.episode <= 0 || input.episode > MAX_EPISODES) {
    throw new Error("Episode number is outside AniStream's supported range.");
  }
}

function validateApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Anikoto API URLs must use HTTPS.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function parseProviderCooldown(response: Response, fallbackMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30 * 60 * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30 * 60 * 1_000);
  }

  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(0, reset * 1_000 - Date.now()), 30 * 60 * 1_000);
  }
  return fallbackMs;
}

function positiveInteger(value: unknown): number | undefined {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replaceAll(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFrom(value: unknown, fallback: string): string {
  if (value instanceof Error) {
    return value.name === "AbortError" ? "Anikoto request timed out." : value.message;
  }
  return fallback;
}
