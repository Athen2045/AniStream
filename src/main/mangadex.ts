import type {
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderChapter,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaDexReaderSession,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const MANGADEX_API_URL = "https://api.mangadex.org";
const DEFAULT_LANGUAGE = "en";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const FORBIDDEN_PAUSE_MS = 5 * 60_000;
const AT_HOME_CACHE_TTL_MS = 15 * 60_000;
const PAGE_CACHE_MAX_ENTRIES = 18;

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
  private readonly chapterCache = createBoundedCache<MangaDexReaderSession>({
    maxEntries: 40,
    ttlMs: 10 * 60_000,
  });
  private readonly atHomeCache = createBoundedCache<AtHomeNode>({
    maxEntries: 20,
    ttlMs: AT_HOME_CACHE_TTL_MS,
  });
  private readonly pageCache = createBoundedCache<MangaDexReaderPage>({
    maxEntries: PAGE_CACHE_MAX_ENTRIES,
    ttlMs: AT_HOME_CACHE_TTL_MS,
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

  public async getReader(input: MangaDexReaderInput): Promise<MangaDexReaderSession> {
    if (!Number.isInteger(input.aniListId) || input.aniListId <= 0 || !isSafeTitle(input.title)) {
      throw new Error("A valid AniList ID and manga title are required.");
    }
    const cacheKey = `${input.aniListId}:${this.translatedLanguage}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached) return cached;

    try {
      const mangaDexId = await this.findMappedManga(input.aniListId, input.title);
      if (!mangaDexId) {
        return this.rememberReader(cacheKey, {
          status: "unmapped",
          aniListId: input.aniListId,
          translatedLanguage: this.translatedLanguage,
          chapters: [],
          message: "MangaDex has no exact AniList mapping for this title.",
        });
      }
      const chapters = await this.getChapters(mangaDexId);
      return this.rememberReader(cacheKey, {
        status: "available",
        aniListId: input.aniListId,
        mangaDexId,
        translatedLanguage: this.translatedLanguage,
        chapters,
        message: chapters.length
          ? undefined
          : `No ${this.translatedLanguage} chapters are currently available on MangaDex.`,
      });
    } catch (error) {
      return {
        status: "unavailable",
        aniListId: input.aniListId,
        translatedLanguage: this.translatedLanguage,
        chapters: [],
        message: error instanceof Error ? error.message : "MangaDex is unavailable.",
      };
    }
  }

  public async getPage(input: MangaDexPageInput): Promise<MangaDexReaderPage> {
    if (!isSafeId(input.chapterId) || !Number.isInteger(input.page) || input.page < 0) {
      throw new Error("Invalid MangaDex page request.");
    }
    const quality = input.quality === "data-saver" ? "data-saver" : "data";
    const cacheKey = `${input.chapterId}:${quality}:${input.page}`;
    const cached = this.pageCache.get(cacheKey);
    if (cached) return cached;

    let image = await this.fetchPageImage(input.chapterId, input.page, quality);
    if (image.response.status === 404 || image.response.status === 410) {
      // MangaDex@Home nodes are temporary. Refresh the scoped chapter node once
      // when a cached image host says the resource has moved or expired.
      this.atHomeCache.delete(input.chapterId);
      image = await this.fetchPageImage(input.chapterId, input.page, quality);
    }
    const { response, files } = image;
    if (!response.ok) throw new Error(`MangaDex page request failed (${response.status}).`);
    const mime = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!mime.startsWith("image/")) throw new Error("MangaDex did not return an image.");
    const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
    const page = {
      chapterId: input.chapterId,
      page: input.page,
      pageCount: files.length,
      imageDataUrl: `data:${mime};base64,${bytes}`,
    };
    this.pageCache.set(cacheKey, page);
    return page;
  }

  private async fetchPageImage(
    chapterId: string,
    page: number,
    quality: "data" | "data-saver",
  ): Promise<{ response: Response; files: string[] }> {
    const node = await this.getAtHomeNode(chapterId);
    const files = quality === "data-saver" ? node.dataSaver : node.data;
    const filename = files[page];
    if (!filename) throw new Error("This MangaDex page does not exist.");
    const imageUrl = new URL(`${quality}/${node.hash}/${filename}`, `${node.baseUrl}/`);
    if (!imageUrl.toString().startsWith(`${node.baseUrl}/`)) {
      throw new Error("MangaDex returned an unsafe image URL.");
    }
    const response = await this.fetcher(imageUrl, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { response, files };
  }

  private async resolveAvailability(
    item: MangaDexAvailabilityInput,
  ): Promise<MangaDexChapterAvailability> {
    const cacheKey = `${item.aniListId}:${this.translatedLanguage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const checkedAt = new Date().toISOString();
    try {
      const mangaDexId = await this.findMappedManga(item.aniListId, item.title);
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

  private async findMappedManga(aniListId: number, title: string): Promise<string | undefined> {
    const searchUrl = new URL("/manga", MANGADEX_API_URL);
    searchUrl.searchParams.set("title", title);
    searchUrl.searchParams.set("limit", "10");
    return findExactAniListMapping(await this.requestJson(searchUrl), aniListId);
  }

  private async getChapters(mangaDexId: string): Promise<MangaDexReaderChapter[]> {
    const chaptersUrl = new URL("/chapter", MANGADEX_API_URL);
    chaptersUrl.searchParams.set("manga", mangaDexId);
    chaptersUrl.searchParams.append("translatedLanguage[]", this.translatedLanguage);
    chaptersUrl.searchParams.append("includes[]", "scanlation_group");
    // Fetch the newest window first so opening a long-running manga starts at
    // a recent readable chapter instead of chapter 1. Full archive paging is
    // deliberately deferred to a dedicated chapter browser.
    chaptersUrl.searchParams.set("order[chapter]", "desc");
    chaptersUrl.searchParams.set("limit", "100");
    return normalizeChapters(await this.requestJson(chaptersUrl));
  }

  private async getAtHomeNode(chapterId: string): Promise<AtHomeNode> {
    const cached = this.atHomeCache.get(chapterId);
    if (cached) return cached;
    const url = new URL(`/at-home/server/${chapterId}`, MANGADEX_API_URL);
    const node = normalizeAtHomeNode(await this.requestJson(url));
    this.atHomeCache.set(chapterId, node);
    return node;
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

  private rememberReader(key: string, value: MangaDexReaderSession): MangaDexReaderSession {
    this.chapterCache.set(key, value);
    return value;
  }
}

interface AtHomeNode {
  baseUrl: string;
  hash: string;
  data: string[];
  dataSaver: string[];
}

export function normalizeChapters(payload: unknown): MangaDexReaderChapter[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const chapters = payload.data
    .map((item): MangaDexReaderChapter | undefined => {
      if (!isRecord(item) || !isSafeId(item.id) || !isRecord(item.attributes)) return undefined;
      const attributes = item.attributes;
      if (typeof attributes.translatedLanguage !== "string") return undefined;
      const pages = typeof attributes.pages === "number" ? attributes.pages : 0;
      if (!Number.isInteger(pages) || pages <= 0) return undefined;
      const groupName = findGroupName(item.relationships);
      return {
        id: item.id,
        number: parseChapterNumber(attributes.chapter),
        volume: typeof attributes.volume === "string" ? attributes.volume : undefined,
        title: typeof attributes.title === "string" ? attributes.title : undefined,
        translatedLanguage: attributes.translatedLanguage,
        groupName,
        publishedAt: typeof attributes.publishAt === "string" ? attributes.publishAt : undefined,
        pages,
      };
    })
    .filter((chapter): chapter is MangaDexReaderChapter => Boolean(chapter));
  return chapters.sort((left, right) => (left.number ?? Infinity) - (right.number ?? Infinity));
}

export function normalizeAtHomeNode(payload: unknown): AtHomeNode {
  if (!isRecord(payload) || typeof payload.baseUrl !== "string" || !isRecord(payload.chapter)) {
    throw new Error("MangaDex returned an invalid MangaDex@Home response.");
  }
  const base = new URL(payload.baseUrl);
  if (base.protocol !== "https:") throw new Error("MangaDex returned a non-HTTPS image host.");
  const hash = payload.chapter.hash;
  const data = payload.chapter.data;
  const dataSaver = payload.chapter.dataSaver;
  if (!isSafeId(hash) || !isStringArray(data) || !isStringArray(dataSaver)) {
    throw new Error("MangaDex returned invalid page metadata.");
  }
  return { baseUrl: base.toString().replace(/\/$/, ""), hash, data, dataSaver };
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

function isSafeTitle(value: string): boolean {
  return value.trim().length >= 1 && value.trim().length <= 240;
}

function parseChapterNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function findGroupName(relationships: unknown): string | undefined {
  if (!Array.isArray(relationships)) return undefined;
  for (const relationship of relationships) {
    if (!isRecord(relationship) || relationship.type !== "scanlation_group") continue;
    if (!isRecord(relationship.attributes)) continue;
    const name = relationship.attributes.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}
