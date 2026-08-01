import type { MangaEnrichment } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const BASE_URL = "https://api.mangabaka.org";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 150;

type Fetcher = typeof fetch;

export class MangaBakaClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 6,
    windowMs: 60_000,
  });
  private readonly cache = createBoundedCache<MangaEnrichment>({
    maxEntries: CACHE_MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  });

  public constructor(
    private readonly fetcher: Fetcher = fetch,
    // Optional PAT: the API works unauthenticated, a token raises rate limits.
    // Real MangaBaka tokens start with "mb-"; other values are ignored rather
    // than sent, so a mispasted token name never leaks into request headers.
    private readonly accessToken = readConfiguredToken(),
  ) {}

  public async getEnrichment(aniListId: number): Promise<MangaEnrichment> {
    if (!Number.isInteger(aniListId) || aniListId <= 0) {
      throw new Error("Invalid AniList manga ID.");
    }
    const cached = this.cache.get(String(aniListId));
    if (cached) return cached;
    const url = new URL(`/v1/source/anilist/${aniListId}`, BASE_URL);
    url.searchParams.set("with_series", "true");
    url.searchParams.set("with_internal", "false");
    url.searchParams.set("with_source_response", "false");
    const value = await this.requestGate.run(url.toString(), async () => {
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "AniStream/0.1.0 (personal macOS app)",
          // MangaBaka documents PATs as x-api-key credentials. OAuth bearer
          // tokens use Authorization and are a separate future integration.
          ...(this.accessToken ? { "x-api-key": this.accessToken } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status === 403) {
        this.requestGate.reportRateLimited(5 * 60_000);
        throw new Error(`MangaBaka temporarily refused requests (${response.status}).`);
      }
      if (!response.ok) throw new Error(`MangaBaka request failed (${response.status}).`);
      return parseMangaBakaEnrichment(await response.json(), aniListId);
    });
    this.cache.set(String(aniListId), value);
    return value;
  }
}

export function readConfiguredToken(): string | undefined {
  const token = process.env.ANISTREAM_MANGABAKA_TOKEN?.trim();
  return token?.startsWith("mb-") ? token : undefined;
}

export function parseMangaBakaEnrichment(payload: unknown, aniListId: number): MangaEnrichment {
  const checkedAt = new Date().toISOString();
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.series)) {
    return unavailable(aniListId, checkedAt, "MangaBaka returned an invalid response.");
  }
  const exact = payload.data.series.filter((item) => {
    if (!isRecord(item) || item.state !== "active" || !isRecord(item.source)) return false;
    const anilist = item.source.anilist;
    return isRecord(anilist) && Number(anilist.id) === aniListId;
  });
  if (exact.length !== 1 || !isRecord(exact[0])) {
    return unavailable(
      aniListId,
      checkedAt,
      "MangaBaka did not return one unique active AniList-ID match.",
    );
  }
  const series = exact[0];
  const source = isRecord(series.source) ? series.source : {};
  const mangaUpdates = isRecord(source.manga_updates) ? source.manga_updates : {};
  return {
    status: "available",
    aniListId,
    mangaBakaId: toPositiveInteger(series.id),
    title: readString(series, ["title", "romanized_title", "native_title"]),
    authors: readNames(series.authors),
    artists: readNames(series.artists),
    publishers: readNames(series.publishers),
    year: toPositiveInteger(series.year),
    type: readString(series, ["type"]),
    publicationStatus: readString(series, ["status"]),
    rating: toFiniteNumber(series.rating),
    popularity: toFiniteNumber(series.popularity),
    totalChapters: toPositiveInteger(series.total_chapters),
    mangaUpdatesId: readString(mangaUpdates, ["id"]),
    mangaUpdatesRating: toFiniteNumber(mangaUpdates.rating),
    checkedAt,
  };
}

function unavailable(aniListId: number, checkedAt: string, message: string): MangaEnrichment {
  return {
    status: "unavailable",
    aniListId,
    authors: [],
    artists: [],
    publishers: [],
    message,
    checkedAt,
  };
}

function readNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [item.trim()];
        if (!isRecord(item)) return [];
        const name = readString(item, ["name", "title"]);
        return name ? [name] : [];
      }),
    ),
  ].slice(0, 12);
}

function readString(value: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const candidate = value[field];
    if (
      (typeof candidate === "string" || typeof candidate === "number") &&
      String(candidate).trim()
    ) {
      return String(candidate).trim();
    }
  }
  return undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
