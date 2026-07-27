import type { MangaDexAvailabilityInput, MangaDexChapterAvailability } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const MANGADEX_API_URL = "https://api.mangadex.org";
const DEFAULT_LANGUAGE = "en";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const FORBIDDEN_PAUSE_MS = 5 * 60_000;

type Fetcher = typeof fetch;

/**
 * Public-read MangaDex adapter. Mapping is accepted only when MangaDex itself
 * exposes the exact AniList ID in attributes.links.al; title similarity alone
 * is deliberately insufficient.
 */
export class MangaDexClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 4,
    windowMs: 1_000,
  });
  private readonly cache = createBoundedCache<MangaDexChapterAvailability>({
    maxEntries: 120,
    ttlMs: 30 * 60_000,
  });

  public constructor(
    private readonly translatedLanguage = process.env.MANGADEX_LANGUAGE?.trim() || DEFAULT_LANGUAGE,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  public async getAvailability(
    media: MangaDexAvailabilityInput[],
  ): Promise<MangaDexChapterAvailability[]> {
    const unique = new Map<number, MangaDexAvailabilityInput>();
    for (const item of media.slice(0, 30)) {
      if (
        Number.isInteger(item.aniListId) &&
        item.aniListId > 0 &&
        item.title.trim().length >= 1 &&
        item.title.trim().length <= 240
      ) {
        unique.set(item.aniListId, { ...item, title: item.title.trim() });
      }
    }
    return Promise.all([...unique.values()].map((item) => this.resolveAvailability(item)));
  }

  private async resolveAvailability(
    item: MangaDexAvailabilityInput,
  ): Promise<MangaDexChapterAvailability> {
    const cacheKey = `${item.aniListId}:${this.translatedLanguage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const checkedAt = new Date().toISOString();
    try {
      const searchUrl = new URL("/manga", MANGADEX_API_URL);
      searchUrl.searchParams.set("title", item.title);
      searchUrl.searchParams.set("limit", "10");
      const search = await this.requestJson(searchUrl);
      const mangaDexId = findExactAniListMapping(search, item.aniListId);
      if (!mangaDexId) {
        return this.remember(cacheKey, {
          aniListId: item.aniListId,
          status: "unmapped",
          translatedLanguage: this.translatedLanguage,
          checkedAt,
          message: "No exact AniList ID mapping was found in MangaDex.",
        });
      }

      const aggregateUrl = new URL(`/manga/${mangaDexId}/aggregate`, MANGADEX_API_URL);
      aggregateUrl.searchParams.append("translatedLanguage[]", this.translatedLanguage);
      const aggregate = await this.requestJson(aggregateUrl);
      return this.remember(cacheKey, {
        aniListId: item.aniListId,
        mangaDexId,
        status: "available",
        translatedLanguage: this.translatedLanguage,
        latestChapter: findLatestNumericChapter(aggregate),
        checkedAt,
      });
    } catch (error) {
      return {
        aniListId: item.aniListId,
        status: "unavailable",
        translatedLanguage: this.translatedLanguage,
        checkedAt,
        message: error instanceof Error ? error.message : "MangaDex is unavailable.",
      };
    }
  }

  private async requestJson(url: URL): Promise<unknown> {
    return this.requestGate.run(url.toString(), async () => {
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "AniStream/0.1.0 (personal macOS app)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429) {
        this.requestGate.reportRateLimited(
          parseRateLimitCooldownMs(
            response.headers.get("x-ratelimit-retry-after"),
            response.headers.get("retry-after"),
          ),
        );
        throw new Error("MangaDex is rate-limiting requests. AniStream paused its request queue.");
      }
      if (response.status === 403) {
        this.requestGate.reportRateLimited(FORBIDDEN_PAUSE_MS);
        throw new Error(
          "MangaDex temporarily refused requests. AniStream paused its request queue.",
        );
      }
      if (!response.ok) throw new Error(`MangaDex request failed (${response.status}).`);
      return response.json() as Promise<unknown>;
    });
  }

  private remember(key: string, value: MangaDexChapterAvailability): MangaDexChapterAvailability {
    this.cache.set(key, value);
    return value;
  }
}

export function findExactAniListMapping(payload: unknown, aniListId: number): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const matches = new Set<string>();
  for (const candidate of payload.data) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
    const attributes = candidate.attributes;
    if (!isRecord(attributes) || !isRecord(attributes.links)) continue;
    if (String(attributes.links.al) === String(aniListId)) matches.add(candidate.id);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

export function findLatestNumericChapter(payload: unknown): number | undefined {
  if (!isRecord(payload) || !isRecord(payload.volumes)) return undefined;
  let latest: number | undefined;
  for (const volume of Object.values(payload.volumes)) {
    if (!isRecord(volume) || !isRecord(volume.chapters)) continue;
    for (const chapterNumber of Object.keys(volume.chapters)) {
      const parsed = Number(chapterNumber);
      if (Number.isFinite(parsed) && parsed >= 0 && (latest === undefined || parsed > latest)) {
        latest = parsed;
      }
    }
  }
  return latest;
}

export function parseRateLimitCooldownMs(
  rateLimitResetHeader: string | null,
  retryAfterHeader: string | null,
): number {
  const resetTimestamp = Number(rateLimitResetHeader);
  if (Number.isFinite(resetTimestamp) && resetTimestamp > 0) {
    return Math.max(0, resetTimestamp * 1_000 - Date.now());
  }
  if (!retryAfterHeader) return DEFAULT_RATE_LIMIT_PAUSE_MS;
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(retryAfterHeader);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : DEFAULT_RATE_LIMIT_PAUSE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
