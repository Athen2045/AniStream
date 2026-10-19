import type { AnimeSkipSegment, AnimeSkipTimesInput } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

/**
 * Opening and ending times for the own player's Skip buttons, from AniSkip
 * (https://api.aniskip.com/api-docs, verified 2026-10-18): community-submitted intervals keyed by
 * MAL id and episode number. Only the MAL id, episode number and stream length are sent.
 */
const ANISKIP_API_URL = "https://api.aniskip.com/v2";
const REQUEST_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 24 * 3_600_000;
/** AniSkip answers with X-RateLimit-Limit 120; this stays well under it (application policy). */
const REQUESTS_PER_MINUTE = 30;
/** After a 429/403, ask again only after this long (or the server's Retry-After). */
const BLOCKED_MS = 10 * 60_000;
/** Shorter than this is not an opening or ending worth a button. */
const MIN_SEGMENT_SECONDS = 10;

type Fetcher = typeof fetch;

export class SkipTimesClient {
  private readonly gate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
    windowMs: 60_000,
  });
  private readonly cache = createBoundedCache<AnimeSkipSegment[]>({
    maxEntries: 400,
    ttlMs: CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;
  private blockedUntil = 0;

  public constructor(
    private readonly baseUrl = ANISKIP_API_URL,
    fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.transport = new ProviderTransport({
      gate: this.gate,
      fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": PROVIDER_USER_AGENT },
    });
  }

  /** Empty when AniSkip has nothing for the episode; throws when it could not be asked. */
  public async getSkipTimes(input: AnimeSkipTimesInput): Promise<AnimeSkipSegment[]> {
    const length = Math.round(input.durationSeconds);
    const key = `${input.malId}:${input.episode}:${length}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.now() < this.blockedUntil) throw new Error("Skip times are paused for now.");
    const url = new URL(`${this.baseUrl}/skip-times/${input.malId}/${input.episode}`);
    url.searchParams.append("types[]", "op");
    url.searchParams.append("types[]", "ed");
    url.searchParams.set("episodeLength", String(length));
    const response = await this.transport.request(url, { dedupeKey: key });
    // AniSkip answers 404 with { found: false } when no one has submitted times yet.
    if (response.status === 404) {
      this.cache.set(key, []);
      return [];
    }
    if (response.status === 429 || response.status === 403) {
      const retry = Number(response.headers.get("retry-after"));
      this.blockedUntil = this.now() + (retry > 0 ? retry * 1_000 : BLOCKED_MS);
      throw new Error("AniSkip asked AniStream to slow down.");
    }
    if (!response.ok) throw new Error(`AniSkip answered ${response.status}.`);
    const segments = parseSkipTimes(await response.json(), input.durationSeconds);
    this.cache.set(key, segments);
    return segments;
  }
}

/**
 * AniSkip's v2 answer → at most one opening and one ending, clamped to the stream. Malformed rows
 * are dropped (the answer is untrusted); the first well-formed row of each kind wins (AniSkip
 * orders by votes).
 */
export function parseSkipTimes(value: unknown, durationSeconds: number): AnimeSkipSegment[] {
  if (!value || typeof value !== "object") return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const segments: AnimeSkipSegment[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const { skipType, interval } = row as { skipType?: unknown; interval?: unknown };
    const kind = skipType === "op" ? "opening" : skipType === "ed" ? "ending" : undefined;
    if (!kind || segments.some((segment) => segment.kind === kind)) continue;
    if (!interval || typeof interval !== "object") continue;
    const { startTime, endTime } = interval as { startTime?: unknown; endTime?: unknown };
    if (typeof startTime !== "number" || typeof endTime !== "number") continue;
    const limit = durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
    const start = Math.max(0, startTime);
    const end = Math.min(limit, endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_SEGMENT_SECONDS)
      continue;
    segments.push({ kind, start, end });
  }
  return segments.sort((a, b) => a.start - b.start);
}
