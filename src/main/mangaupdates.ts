import type { MangaUpdatesEnrichment, MangaUpdatesGroup } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const BASE_URL = "https://api.mangaupdates.com/v1/";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
type Fetcher = typeof fetch;

/** Exact-ID public MangaUpdates enrichment; it does not deliver page images. */
export class MangaUpdatesClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 6,
    windowMs: 60_000,
  });
  private readonly cache = createBoundedCache<MangaUpdatesEnrichment>({
    maxEntries: 150,
    ttlMs: CACHE_TTL_MS,
  });

  public constructor(private readonly fetcher: Fetcher = fetch) {}

  public async getSeries(seriesId: number): Promise<MangaUpdatesEnrichment> {
    validateSeriesId(seriesId);
    const cacheKey = String(seriesId);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const value = await this.requestGate.run(cacheKey, async () => {
      const response = await this.fetcher(
        new URL(`series/${seriesId}`, BASE_URL),
        requestOptions(),
      );
      if (response.status === 404)
        return unavailable(seriesId, "MangaUpdates series was not found.");
      this.handleProviderStatus(response.status, "MangaUpdates");
      if (!response.ok) throw new Error(`MangaUpdates request failed (${response.status}).`);
      return parseMangaUpdatesSeries(await response.json(), seriesId);
    });
    this.cache.set(cacheKey, value);
    return value;
  }

  public async getGroups(seriesId: number): Promise<MangaUpdatesGroup[]> {
    validateSeriesId(seriesId);
    return this.requestGate.run(`groups:${seriesId}`, async () => {
      const response = await this.fetcher(
        new URL(`series/${seriesId}/groups`, BASE_URL),
        requestOptions(),
      );
      if (response.status === 404) return [];
      this.handleProviderStatus(response.status, "MangaUpdates groups");
      if (!response.ok) throw new Error(`MangaUpdates groups request failed (${response.status}).`);
      return parseMangaUpdatesGroups(await response.json());
    });
  }

  private handleProviderStatus(status: number, provider: string): void {
    if (status === 429 || status === 403 || status === 503) {
      this.requestGate.reportRateLimited(5 * 60_000);
      throw new Error(`${provider} temporarily refused requests (${status}).`);
    }
  }
}

export function parseMangaUpdatesSeries(
  payload: unknown,
  expectedSeriesId: number,
): MangaUpdatesEnrichment {
  const checkedAt = new Date().toISOString();
  if (!isRecord(payload) || toPositiveInteger(payload.series_id) !== expectedSeriesId) {
    return unavailable(
      expectedSeriesId,
      "MangaUpdates returned an invalid or mismatched series.",
      checkedAt,
    );
  }
  return {
    status: "available",
    seriesId: expectedSeriesId,
    title: readString(payload.title),
    url: readHttpsUrl(payload.url),
    type: readString(payload.type),
    latestChapter: toNonNegativeNumber(payload.latest_chapter),
    licensed: typeof payload.licensed === "boolean" ? payload.licensed : undefined,
    completed: typeof payload.completed === "boolean" ? payload.completed : undefined,
    groups: [],
    checkedAt,
  };
}

export function parseMangaUpdatesGroups(payload: unknown): MangaUpdatesGroup[] {
  if (!isRecord(payload) || !Array.isArray(payload.group_list)) return [];
  return payload.group_list
    .flatMap((item): MangaUpdatesGroup[] => {
      if (!isRecord(item)) return [];
      const id = toPositiveInteger(item.group_id);
      const name = readString(item.name);
      if (!id || !name) return [];
      return [{ id, name, url: readHttpsUrl(item.url) }];
    })
    .slice(0, 50);
}

function requestOptions(): RequestInit {
  return {
    headers: {
      Accept: "application/json",
      "User-Agent": "AniStream/0.1.0 (personal macOS app)",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function validateSeriesId(seriesId: number): void {
  if (!Number.isInteger(seriesId) || seriesId <= 0)
    throw new Error("Invalid MangaUpdates series ID.");
}

function unavailable(
  seriesId: number,
  message: string,
  checkedAt = new Date().toISOString(),
): MangaUpdatesEnrichment {
  return { status: "unavailable", seriesId, groups: [], message, checkedAt };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
