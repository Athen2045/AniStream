import type {
  AnimeEpisodeCatalog,
  AnimeEpisodeCatalogInput,
  AnimePlaybackCandidate,
  AnimePlaybackInput,
  AnimePlaybackResult,
  AnimeProviderEpisode,
  ProviderReadiness,
} from "../shared/contracts";
import { cleanDisplayText } from "../shared/text";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { fillUrlTemplate, type AnimeSourceConfig } from "./provider-config";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

const RECENT_CACHE_MS = 15 * 60 * 1_000;
const SERIES_CACHE_MS = 30 * 60 * 1_000;
const REQUEST_INTERVAL_MS = 2_100;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 120_000;
const FORBIDDEN_COOLDOWN_MS = 10 * 60 * 1_000;
const MAX_EPISODES = 2_000;

// The anime source is removable and configured only through the gitignored provider config;
// playback falls back to AniList episode numbers whenever the episode index has no exact match.

interface RecentSeries {
  id: number;
  aniListId: number;
  title: string;
}

export class AnimeSourceClient {
  private readonly recent = createBoundedCache<unknown>({
    maxEntries: 1,
    ttlMs: RECENT_CACHE_MS,
  });
  private readonly series = createBoundedCache<unknown>({
    maxEntries: 100,
    ttlMs: SERIES_CACHE_MS,
  });
  // The episode index documents a strict minimum gap between requests rather than a per-minute
  // budget, so the shared gate is used purely for its dedupe + pacing primitives.
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: Number.POSITIVE_INFINITY,
    minIntervalMs: REQUEST_INTERVAL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly config: AnimeSourceConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "User-Agent": PROVIDER_USER_AGENT,
      },
    });
  }

  public async getEpisodeCatalog(input: AnimeEpisodeCatalogInput): Promise<AnimeEpisodeCatalog> {
    const fallback = createAniListCatalog(input);

    try {
      const match = await this.findRecentSeries(input.aniListId);
      if (!match) {
        return fallback;
      }

      const payload = await this.getSeries(match.id);
      const catalog = parseEpisodeIndexSeries(payload, input);
      if (catalog.status === "available") return catalog;

      return {
        ...fallback,
        providerTitle: match.title,
        message:
          "The episode index matched this AniList title but returned no valid episode rows. AniStream is using AniList episode numbers with the direct AniList-ID player route.",
      };
    } catch (reason) {
      return {
        ...fallback,
        message: `${messageFrom(reason, "Episode details are unavailable.")} AniStream is using AniList episode numbers with the direct AniList-ID player route.`,
      };
    }
  }

  public async checkReadiness(): Promise<ProviderReadiness> {
    const checkedAt = new Date().toISOString();
    try {
      const payload = await this.getRecentIndex();
      if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.data)) {
        // A Retry must be able to perform a fresh check instead of retaining a malformed response
        // for the full recent-index TTL.
        this.recent.delete("recent");
        return {
          provider: "anime-source",
          status: "unavailable",
          checkedAt,
          message: "The episode index returned an unexpected readiness response.",
        };
      }
      return { provider: "anime-source", status: "ready", checkedAt };
    } catch (reason) {
      const detail = messageFrom(reason, "The episode index is unavailable.");
      if (/rate limit|429|cooldown/i.test(detail)) {
        return {
          provider: "anime-source",
          status: "rate-limited",
          checkedAt,
          message: "Anime playback is busy right now. Please try again after its cooldown.",
        };
      }
      if (/failed to fetch|fetch failed|network|offline|enotfound|econn|dns|socket/i.test(detail)) {
        return {
          provider: "anime-source",
          status: "offline",
          checkedAt,
          message: "AniStream could not reach the network while checking anime playback.",
        };
      }
      return {
        provider: "anime-source",
        status: "unavailable",
        checkedAt,
        message: "Anime playback availability could not be confirmed.",
      };
    }
  }

  public async getPlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult> {
    validatePlaybackInput(input);

    const requestedAudio = input.audio ?? "sub";
    const audioOptions =
      requestedAudio === "sub" ? (["sub", "dub"] as const) : (["dub", "sub"] as const);
    const embedId = parseProviderEpisodeId(input.providerEpisodeId);
    const candidates = audioOptions.map((audio) =>
      createEmbedCandidate(this.config, input, audio, embedId),
    );

    return {
      status: "available",
      candidates,
      attemptedSources: ["episode-index", "anime-player"],
    };
  }

  private async findRecentSeries(aniListId: number): Promise<RecentSeries | undefined> {
    return findExactRecentAniListSeries(await this.getRecentIndex(), aniListId);
  }

  private async getRecentIndex(): Promise<unknown> {
    const cacheKey = "recent";
    let recent = this.recent.get(cacheKey);
    if (!recent) {
      recent = await this.requestJson(new URL(this.config.recentIndexUrl));
      this.recent.set(cacheKey, recent);
    }
    return recent;
  }

  private async getSeries(seriesId: number): Promise<unknown> {
    const cacheKey = String(seriesId);
    const cached = this.series.get(cacheKey);
    if (cached) return cached;

    const value = await this.requestJson(
      new URL(fillUrlTemplate(this.config.seriesUrl, { seriesId })),
    );
    this.series.set(cacheKey, value);
    return value;
  }

  private async requestJson(url: URL): Promise<unknown> {
    return this.transport.requestJson(url, {
      onResponse: (providerResponse, gate) => {
        if (providerResponse.status === 429) {
          gate.reportRateLimited(
            parseProviderCooldown(providerResponse, DEFAULT_RATE_LIMIT_COOLDOWN_MS),
          );
          throw new Error("Episode index rate limit reached. Try again after its cooldown.");
        }
        if (providerResponse.status === 403) {
          gate.reportRateLimited(FORBIDDEN_COOLDOWN_MS);
          throw new Error(
            "The episode index temporarily blocked this IP. AniStream paused provider requests.",
          );
        }
        if (!providerResponse.ok) {
          throw new Error(`The episode index returned HTTP ${providerResponse.status}.`);
        }
      },
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

export function parseEpisodeIndexSeries(
  payload: unknown,
  input: AnimeEpisodeCatalogInput,
): AnimeEpisodeCatalog {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) {
    return unavailableCatalog("The episode index returned an invalid series payload.");
  }

  const anime = payload.data.anime;
  const episodes = payload.data.episodes;
  if (
    !isRecord(anime) ||
    positiveInteger(anime.ani_id) !== input.aniListId ||
    !Array.isArray(episodes)
  ) {
    return unavailableCatalog(
      "The episode index series identity did not match the requested AniList ID.",
    );
  }

  const normalized = episodes
    .flatMap((episode): AnimeProviderEpisode[] => {
      if (!isRecord(episode)) return [];
      const number = positiveInteger(episode.number);
      const embedId = cleanString(episode.episode_embed_id);
      if (!number || number > MAX_EPISODES || !embedId || !/^\d+$/.test(embedId)) return [];

      const title = cleanString(episode.title);
      const thumbnailUrl =
        safeHttpsUrl(episode.thumbnail_url) ??
        safeHttpsUrl(episode.thumbnail) ??
        safeHttpsUrl(episode.image);
      const description = cleanString(episode.description) ?? cleanString(episode.synopsis);

      return [
        {
          id: `index:${embedId}`,
          number,
          ...(title ? { title } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
          ...(description ? { description } : {}),
        },
      ];
    })
    .sort((left, right) => left.number - right.number)
    .filter((episode, index, all) => index === 0 || episode.number !== all[index - 1]?.number);

  if (!normalized.length)
    return unavailableCatalog("The episode index returned no valid episodes.");

  return {
    status: "available",
    provider: "anime-source",
    providerTitle: cleanString(anime.title),
    seasons: [
      {
        id: `index:${input.aniListId}:season:1`,
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
    provider: "anime-source",
    providerTitle: input.titles[0],
    seasons: [
      {
        id: `anilist:${input.aniListId}:season:1`,
        number: 1,
        title: input.seasonLabel ?? "Season 1",
        episodes: Array.from({ length: count }, (_, index) => ({
          id: `anilist:${input.aniListId}:episode:${index + 1}`,
          number: index + 1,
        })),
      },
    ],
    checkedAt: new Date().toISOString(),
  };
}

function unavailableCatalog(message: string): AnimeEpisodeCatalog {
  return {
    status: "unavailable",
    provider: "anime-source",
    seasons: [],
    message,
    checkedAt: new Date().toISOString(),
  };
}

function createEmbedCandidate(
  config: AnimeSourceConfig,
  input: AnimePlaybackInput,
  audio: "sub" | "dub",
  embedId?: string,
): AnimePlaybackCandidate {
  const url = embedId
    ? fillUrlTemplate(config.episodeEmbedUrl, { embedId, audio })
    : fillUrlTemplate(config.aniListEmbedUrl, {
        aniListId: input.aniListId,
        episode: input.episode,
        audio,
      });

  return {
    id: `index:${input.aniListId}:${input.episode}:${audio}`,
    label: audio === "sub" ? "Japanese · subtitles" : "English dub",
    kind: "embed",
    url: new URL(url).toString(),
    language: audio,
    provider: "anime-source",
  };
}

function parseProviderEpisodeId(value?: string): string | undefined {
  if (!value) return undefined;
  return /^index:(\d+)$/.exec(value)?.[1];
}

function validatePlaybackInput(input: AnimePlaybackInput): void {
  if (!Number.isSafeInteger(input.aniListId) || input.aniListId <= 0) {
    throw new Error("AniList ID must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.episode) || input.episode <= 0 || input.episode > MAX_EPISODES) {
    throw new Error("Episode number is outside AniStream's supported range.");
  }
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
  const cleaned = cleanDisplayText(value);
  return cleaned || undefined;
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
    return value.name === "AbortError" ? "The episode index request timed out." : value.message;
  }
  return fallback;
}
