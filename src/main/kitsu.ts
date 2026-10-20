import type { AnimeEpisodeArt, AnimeEpisodeArtInput } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import {
  KITSU_EPISODE_PAGE_SIZE,
  MAX_KITSU_EPISODES,
  parseKitsuAnimeMapping,
  parseKitsuEpisodeArt,
  planKitsuEpisodePages,
} from "./kitsu-episode-art";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

const KITSU_API_URL = "https://kitsu.io/api/edge";
const REQUEST_TIMEOUT_MS = 12_000;
const MAPPING_CACHE_TTL_MS = 24 * 3_600_000;
const EPISODE_PAGE_CACHE_TTL_MS = 6 * 3_600_000;

export interface KitsuEpisodeArtResult {
  art: AnimeEpisodeArt[];
  /** False when an episode page failed; the caller should not cache a partial result. */
  complete: boolean;
}

type Fetcher = typeof fetch;

/**
 * Kitsu episode thumbnails, after an exact AniList mapping. AniList remains the source of media
 * identity and metadata. (The development-only hero-art preview was removed 2026-10-20 so dev
 * builds show the same AniList banners as releases.)
 */
export class KitsuClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 30,
    windowMs: 60_000,
  });
  /** AniList ID → Kitsu anime ID; null records a confirmed "no exact mapping". */
  private readonly mappingCache = createBoundedCache<number | null>({
    maxEntries: 400,
    ttlMs: MAPPING_CACHE_TTL_MS,
  });
  private readonly episodePageCache = createBoundedCache<AnimeEpisodeArt[]>({
    maxEntries: 200,
    ttlMs: EPISODE_PAGE_CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly apiBaseUrl = KITSU_API_URL,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/vnd.api+json",
        "User-Agent": PROVIDER_USER_AGENT,
      },
    });
  }

  /** Episode thumbnails for one AniList anime entry, through Kitsu's exact AniList mapping. */
  public async getEpisodeArt(input: AnimeEpisodeArtInput): Promise<KitsuEpisodeArtResult> {
    if (!Number.isInteger(input.aniListId) || input.aniListId <= 0) {
      throw new Error("Invalid Kitsu episode-art lookup input.");
    }
    const kitsuId = await this.resolveAnimeId(input.aniListId);
    const result: KitsuEpisodeArtResult = { art: [], complete: true };
    if (kitsuId === undefined) return result;

    const pages = await Promise.all(
      planKitsuEpisodePages(input.episodes, input.focus).map(async (offset) => {
        try {
          return await this.episodePage(kitsuId, offset, input.episodes);
        } catch {
          // One failed page costs only its own thumbnails; the rest still show.
          result.complete = false;
          return [];
        }
      }),
    );
    const byNumber = new Map(pages.flat().map((row) => [row.number, row] as const));
    result.art = [...byNumber.values()].sort((a, b) => a.number - b.number);
    return result;
  }

  private async resolveAnimeId(aniListId: number): Promise<number | undefined> {
    const cached = this.mappingCache.get(String(aniListId));
    if (cached !== undefined) return cached ?? undefined;
    const url = new URL(`${this.apiBaseUrl}/mappings`);
    url.searchParams.set("filter[externalSite]", "anilist/anime");
    url.searchParams.set("filter[externalId]", String(aniListId));
    // JSON:API fills `relationships.item.data` only when the item is included.
    url.searchParams.set("include", "item");
    url.searchParams.set("fields[anime]", "slug");
    url.searchParams.set("page[limit]", "5");
    const kitsuId = parseKitsuAnimeMapping(
      await this.get(url, `kitsu-mapping:${aniListId}`),
      aniListId,
    );
    this.mappingCache.set(String(aniListId), kitsuId ?? null);
    return kitsuId;
  }

  private async episodePage(
    kitsuId: number,
    offset: number,
    episodes: number,
  ): Promise<AnimeEpisodeArt[]> {
    const key = `${kitsuId}:${offset}`;
    const cached = this.episodePageCache.get(key);
    if (cached) return cached.filter((row) => row.number <= episodes);
    const url = new URL(`${this.apiBaseUrl}/anime/${kitsuId}/episodes`);
    url.searchParams.set("sort", "number");
    url.searchParams.set("page[limit]", String(KITSU_EPISODE_PAGE_SIZE));
    url.searchParams.set("page[offset]", String(offset));
    url.searchParams.set("fields[episodes]", "number,thumbnail");
    // Cached unfiltered so a later lookup with more aired episodes can reuse the page.
    const art = parseKitsuEpisodeArt(
      await this.get(url, `kitsu-episodes:${key}`),
      MAX_KITSU_EPISODES,
    );
    this.episodePageCache.set(key, art);
    return art.filter((row) => row.number <= episodes);
  }

  private get(url: URL, dedupeKey: string): Promise<unknown> {
    return this.transport.requestParsed(
      url,
      {
        dedupeKey,
        onResponse: (response, gate) => {
          if (response.status === 429 || response.status === 403) {
            gate.reportRateLimited(5 * 60_000);
            throw new Error(`Kitsu temporarily refused requests (${response.status}).`);
          }
        },
      },
      (response) => {
        if (!response.ok) throw new Error(`Kitsu request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      },
    );
  }
}
