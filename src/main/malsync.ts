import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

const BASE_URL = "https://api.malsync.moe";
const REQUEST_TIMEOUT_MS = 12_000;
// MAL-Sync publishes no rate limit; this is a conservative application policy.
const REQUESTS_PER_MINUTE = 20;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const REFUSED_PAUSE_MS = 5 * 60_000;

type Fetcher = typeof fetch;

/** One page of a title on a site, as MAL-Sync maps it from an exact AniList ID. */
export interface MalSyncSitePage {
  /** The site's own series identifier. */
  identifier: string;
  title: string;
  url: string;
}

export interface MalSyncMapping {
  /** MAL-Sync's canonical title for the AniList ID; used only to break ties between exact-ID entries. */
  title?: string;
  pages: MalSyncSitePage[];
}

/**
 * MAL-Sync community mapping: AniList ID → pages on other sites. Identity comes only from the
 * exact AniList ID MAL-Sync records for each entry; titles never establish identity.
 */
export class MalSyncClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
    windowMs: 60_000,
  });
  private readonly cache = createBoundedCache<MalSyncMapping>({
    maxEntries: 200,
    ttlMs: CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(private readonly fetcher: Fetcher = fetch) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json", "User-Agent": PROVIDER_USER_AGENT },
    });
  }

  public async getSitePages(
    aniListId: number,
    site: string,
    signal?: AbortSignal,
  ): Promise<MalSyncMapping> {
    if (!Number.isInteger(aniListId) || aniListId <= 0) throw new Error("Invalid AniList ID.");
    const cacheKey = `${aniListId}:${site}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const url = new URL(`/mal/manga/anilist:${aniListId}`, BASE_URL);
    const mapping = await this.transport.requestParsed(
      url,
      {
        signal,
        onResponse: (response, gate) => {
          if (response.status === 429 || response.status === 403) {
            gate.reportRateLimited(REFUSED_PAUSE_MS);
            throw new Error(`MAL-Sync temporarily refused requests (${response.status}).`);
          }
        },
      },
      async (response): Promise<MalSyncMapping> => {
        // MAL-Sync answers 404 for titles it has not mapped.
        if (response.status === 404) return { pages: [] };
        if (!response.ok) throw new Error(`MAL-Sync request failed (${response.status}).`);
        return parseMalSyncMapping(await response.json(), aniListId, site);
      },
    );
    this.cache.set(cacheKey, mapping);
    return mapping;
  }
}

export function parseMalSyncMapping(
  payload: unknown,
  aniListId: number,
  site: string,
): MalSyncMapping {
  if (!isRecord(payload) || !isRecord(payload.Sites)) return { pages: [] };
  const title = typeof payload.title === "string" ? payload.title.trim() : undefined;
  const entries = payload.Sites[site];
  if (!isRecord(entries)) return { title, pages: [] };
  const pages = Object.values(entries).flatMap((entry): MalSyncSitePage[] => {
    if (!isRecord(entry)) return [];
    // Every entry must carry the exact AniList ID we asked for.
    if (Number(entry.aniId) !== aniListId) return [];
    const identifier = typeof entry.identifier === "string" ? entry.identifier.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(identifier)) return [];
    const entryTitle = typeof entry.title === "string" ? entry.title.trim() : "";
    const url = typeof entry.url === "string" ? entry.url : "";
    return [{ identifier, title: entryTitle, url }];
  });
  return { title, pages };
}

/**
 * One series per AniList ID. When MAL-Sync lists several exact-ID entries on the site (for example
 * a regular and a colored edition), only an entry whose title equals MAL-Sync's canonical title
 * (case-insensitive) is accepted; anything still ambiguous gets no fallback.
 */
export function pickMalSyncPage(mapping: MalSyncMapping): MalSyncSitePage | undefined {
  if (mapping.pages.length === 1) return mapping.pages[0];
  const canonical = mapping.title?.toLocaleLowerCase();
  if (!canonical) return undefined;
  const exact = mapping.pages.filter((page) => page.title.toLocaleLowerCase() === canonical);
  return exact.length === 1 ? exact[0] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
