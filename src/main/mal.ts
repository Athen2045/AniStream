import type { AniListMediaType, MalRankingItem, MalScore } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const MAL_API_URL = "https://api.myanimelist.net/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const SCORE_CACHE_TTL_MS = 30 * 60_000;
const RANKING_CACHE_TTL_MS = 10 * 60_000;
const RANKING_LIMIT = 20;

type Fetcher = typeof fetch;

/**
 * MyAnimeList public-data client. Serves two purposes per the 2026-07-29 user
 * direction: cross-referenced MAL community scores next to AniList scores, and a
 * catalog fallback so Trending still renders when AniList itself is down. Public
 * reads need only the Client ID header; no OAuth secret is stored or used.
 */
export class MalClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 30,
    windowMs: 60_000,
  });
  private readonly scoreCache = createBoundedCache<MalScore>({
    maxEntries: 120,
    ttlMs: SCORE_CACHE_TTL_MS,
  });
  private readonly rankingCache = createBoundedCache<MalRankingItem[]>({
    maxEntries: 2,
    ttlMs: RANKING_CACHE_TTL_MS,
  });

  public constructor(
    private readonly clientId = process.env.ANISTREAM_MAL_CLIENT_ID?.trim(),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  public get configured(): boolean {
    return Boolean(this.clientId);
  }

  public async getScore(type: AniListMediaType, malId: number): Promise<MalScore | undefined> {
    if (!this.configured) return undefined;
    if (!Number.isInteger(malId) || malId <= 0) throw new Error("Invalid MyAnimeList ID.");

    const kind = type === "ANIME" ? "anime" : "manga";
    const cacheKey = `${kind}:${malId}`;
    const cached = this.scoreCache.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${MAL_API_URL}/${kind}/${malId}`);
    url.searchParams.set("fields", "mean,rank,num_scoring_users");
    try {
      const payload = await this.requestJson(url, cacheKey);
      const score = parseMalScore(payload, kind);
      if (score) this.scoreCache.set(cacheKey, score);
      return score;
    } catch {
      // Score enrichment is optional; the AniList score remains authoritative.
      return undefined;
    }
  }

  public async getRanking(type: AniListMediaType): Promise<MalRankingItem[]> {
    if (!this.configured) return [];

    const kind = type === "ANIME" ? "anime" : "manga";
    const cached = this.rankingCache.get(kind);
    if (cached) return cached;

    const url = new URL(`${MAL_API_URL}/${kind}/ranking`);
    // "airing"/"bypopularity" approximate AniList's trending semantics better than
    // the all-time "all" ranking.
    url.searchParams.set("ranking_type", kind === "anime" ? "airing" : "bypopularity");
    url.searchParams.set("limit", String(RANKING_LIMIT));
    url.searchParams.set("fields", "mean,main_picture");

    const payload = await this.requestJson(url, `ranking:${kind}`);
    const ranking = parseMalRanking(payload, kind);
    this.rankingCache.set(kind, ranking);
    return ranking;
  }

  private async requestJson(url: URL, deduplicationKey: string): Promise<unknown> {
    if (!this.clientId) throw new Error("MyAnimeList is not configured.");
    const clientId = this.clientId;
    return this.requestGate.run(deduplicationKey, async () => {
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "X-MAL-CLIENT-ID": clientId,
          "User-Agent": "AniStream/0.1.0 (personal macOS app)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status === 403) {
        this.requestGate.reportRateLimited(5 * 60_000);
        throw new Error(`MyAnimeList temporarily refused requests (${response.status}).`);
      }
      if (!response.ok) throw new Error(`MyAnimeList request failed (${response.status}).`);
      return response.json() as Promise<unknown>;
    });
  }
}

export function parseMalScore(payload: unknown, kind: "anime" | "manga"): MalScore | undefined {
  if (!isRecord(payload) || typeof payload.id !== "number" || payload.id <= 0) return undefined;
  return {
    malId: payload.id,
    score: toFiniteNumber(payload.mean),
    rank: toFiniteNumber(payload.rank),
    scoredBy: toFiniteNumber(payload.num_scoring_users),
    malUrl: `https://myanimelist.net/${kind}/${payload.id}`,
  };
}

export function parseMalRanking(payload: unknown, kind: "anime" | "manga"): MalRankingItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((entry): MalRankingItem[] => {
    if (!isRecord(entry) || !isRecord(entry.node)) return [];
    const node = entry.node;
    if (typeof node.id !== "number" || node.id <= 0) return [];
    const title = typeof node.title === "string" ? node.title.trim() : "";
    if (!title) return [];

    const picture = isRecord(node.main_picture) ? node.main_picture : undefined;
    const coverCandidate = picture?.large ?? picture?.medium;
    const coverUrl = readHttpsUrl(coverCandidate);
    return [
      {
        malId: node.id,
        title,
        coverUrl,
        score: toFiniteNumber(node.mean),
        malUrl: `https://myanimelist.net/${kind}/${node.id}`,
      },
    ];
  });
}

function readHttpsUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate.length > 8_000) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
