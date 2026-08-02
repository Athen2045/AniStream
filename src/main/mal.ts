import type {
  AniListMediaType,
  MalRankingItem,
  MalScore,
  MangaPublicationKind,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { mangaKindFromMalMediaType } from "./manga-kind";
import { ProviderTransport } from "./provider-transport";

const MAL_API_URL = "https://api.myanimelist.net/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const SCORE_CACHE_TTL_MS = 30 * 60_000;
const RANKING_CACHE_TTL_MS = 10 * 60_000;
const MEDIA_TYPE_CACHE_TTL_MS = 24 * 60 * 60_000;
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
  private readonly mangaKindCache = createBoundedCache<MangaPublicationKind>({
    maxEntries: 120,
    ttlMs: MEDIA_TYPE_CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly clientId = process.env.ANISTREAM_MAL_CLIENT_ID?.trim(),
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent": "AniStream/0.1.0 (personal macOS app)",
      },
    });
  }

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

  public async getMangaPublicationKind(malId: number): Promise<MangaPublicationKind | undefined> {
    if (!this.configured) return undefined;
    if (!Number.isInteger(malId) || malId <= 0) throw new Error("Invalid MyAnimeList ID.");
    const cacheKey = `manga-kind:${malId}`;
    const cached = this.mangaKindCache.get(cacheKey);
    if (cached) return cached;

    const url = new URL(`${MAL_API_URL}/manga/${malId}`);
    url.searchParams.set("fields", "media_type");
    try {
      const payload = await this.requestJson(url, cacheKey);
      const publicationKind = parseMalMangaPublicationKind(payload);
      if (publicationKind) this.mangaKindCache.set(cacheKey, publicationKind);
      return publicationKind;
    } catch {
      return undefined;
    }
  }

  private async requestJson(url: URL, deduplicationKey: string): Promise<unknown> {
    if (!this.clientId) throw new Error("MyAnimeList is not configured.");
    const clientId = this.clientId;
    return this.transport.requestParsed(
      url,
      {
        dedupeKey: deduplicationKey,
        headers: { "X-MAL-CLIENT-ID": clientId },
        onResponse: (providerResponse, gate) => {
          if (providerResponse.status === 429 || providerResponse.status === 403) {
            gate.reportRateLimited(5 * 60_000);
            throw new Error(
              `MyAnimeList temporarily refused requests (${providerResponse.status}).`,
            );
          }
        },
      },
      (response) => {
        if (!response.ok) throw new Error(`MyAnimeList request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      },
    );
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

export function parseMalMangaPublicationKind(payload: unknown): MangaPublicationKind | undefined {
  if (!isRecord(payload)) return undefined;
  return mangaKindFromMalMediaType(
    typeof payload.media_type === "string" ? payload.media_type : undefined,
  );
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
