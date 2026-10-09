import type {
  LatestMangaUpdate,
  LatestUpdatesPage,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderChapter,
  MangaExternalChapter,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaDexReaderSession,
  MangaDexScanlationGroup,
  MangaDexStatistics,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { mangaKindFromOriginalLanguage } from "./manga-kind";
import type { MangaDexMappingStore } from "./mangadex-mappings";
import { isMangaLanguage, toMangaLanguage } from "../shared/manga-languages";
import {
  mapSettledWithConcurrency,
  PROVIDER_USER_AGENT,
  ProviderTransport,
} from "./provider-transport";

const MANGADEX_API_URL = "https://api.mangadex.org";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const FORBIDDEN_PAUSE_MS = 5 * 60_000;
const AT_HOME_CACHE_TTL_MS = 15 * 60_000;
const PAGE_CACHE_MAX_ENTRIES = 18;
// New chapter uploads land continuously; refetch the "latest updates" rail at most
// every 5 minutes to stay polite to MangaDex.
const LATEST_UPDATES_TTL_MS = 5 * 60_000;
const LATEST_UPDATES_LIMIT = 21;
// The manga feed accepts up to 500 chapters per page (the generic /chapter list caps at 100).
const CHAPTER_PAGE_LIMIT = 500;
// MangaDex's /manga, /chapter, and feed defaults omit "pornographic". The user directed that
// adult content must not be filtered (2026-07-29), so every listing asks for all four ratings.
const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"] as const;
const AT_HOME_REPORT_URL = "https://api.mangadex.network/report";
const AT_HOME_REPORT_TIMEOUT_MS = 10_000;
// Title search is sorted by relevance (the API default is latest upload, which ranked exact
// matches as low as 98th). The window is wide enough to also see duplicate AniList links.
const MAPPING_SEARCH_LIMIT = 50;
const MAX_READER_CHAPTERS = 2_000;
const MAX_HINTED_CANDIDATES = 3;
// Application scheduling policy, not a provider quota. Keep optional library checks
// from placing all 30 titles ahead of interactive reader requests in the shared gate.
const AVAILABILITY_CONCURRENCY = 4;

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
  private readonly atHomeRequestGate: RequestGate = createRequestGate({
    requestsPerMinute: 35,
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
    maxBytes: 32 * 1024 * 1024,
    sizeOf: (page) => page.imageBytes.byteLength,
    ttlMs: AT_HOME_CACHE_TTL_MS,
  });
  private readonly pageInFlight = new Map<string, Promise<MangaDexReaderPage>>();
  private readonly latestUpdatesCache = createBoundedCache<LatestUpdatesPage<LatestMangaUpdate>>({
    maxEntries: 20,
    ttlMs: LATEST_UPDATES_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly translatedLanguage: string = toMangaLanguage(process.env.MANGADEX_LANGUAGE),
    private readonly fetcher: Fetcher = fetch,
    private readonly options: MangaDexClientOptions = {},
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "User-Agent": PROVIDER_USER_AGENT,
      },
    });
  }

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
    const results = await mapSettledWithConcurrency(
      [...unique.values()],
      AVAILABILITY_CONCURRENCY,
      (item) => this.resolveAvailability(item),
    );
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  }

  public async getLatestUpdates(page: number): Promise<LatestUpdatesPage<LatestMangaUpdate>> {
    if (!Number.isInteger(page) || page < 1 || page > 5_000) {
      throw new Error("Invalid latest manga page.");
    }
    const cacheKey = `latest:${page}`;
    const cached = this.latestUpdatesCache.get(cacheKey);
    if (cached) return cached;

    const url = new URL("/manga", MANGADEX_API_URL);
    url.searchParams.set("limit", String(LATEST_UPDATES_LIMIT));
    url.searchParams.set("offset", String((page - 1) * LATEST_UPDATES_LIMIT));
    url.searchParams.append("order[latestUploadedChapter]", "desc");
    url.searchParams.append("includes[]", "cover_art");
    appendContentRatings(url);
    url.searchParams.append("availableTranslatedLanguage[]", this.translatedLanguage);

    const payload = await this.requestJson(url);
    let items = parseLatestMangaUpdates(payload);
    const chapterIds = findLatestChapterIds(payload);
    if (chapterIds.size) {
      const chapterUrl = new URL("/chapter", MANGADEX_API_URL);
      chapterUrl.searchParams.set("limit", String(Math.min(100, chapterIds.size)));
      appendContentRatings(chapterUrl);
      for (const chapterId of chapterIds.values()) {
        chapterUrl.searchParams.append("ids[]", chapterId);
      }
      try {
        items = mergeLatestChapterDetails(items, chapterIds, await this.requestJson(chapterUrl));
      } catch {
        // The listing itself remains useful if the optional chapter-detail batch fails.
      }
    }
    const updates = {
      pageInfo: parseMangaDexPageInfo(payload, page, LATEST_UPDATES_LIMIT),
      items,
    };
    this.latestUpdatesCache.set(cacheKey, updates);
    return updates;
  }

  public async getReader(
    input: MangaDexReaderInput,
    signal?: AbortSignal,
  ): Promise<MangaDexReaderSession> {
    if (!Number.isInteger(input.aniListId) || input.aniListId <= 0 || !isSafeTitle(input.title)) {
      throw new Error("A valid AniList ID and manga title are required.");
    }
    const translatedLanguage = normalizeLanguage(
      input.translatedLanguage ?? this.translatedLanguage,
    );
    const preferredGroupId = isSafeId(input.preferredGroupId) ? input.preferredGroupId : undefined;
    const cacheKey = `${input.aniListId}:${translatedLanguage}:${preferredGroupId ?? "any"}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached) return cached;

    try {
      const mapping =
        (await this.findMappedManga(input.aniListId, input.title, signal)) ??
        (await this.findHintedManga(input.aniListId, signal));
      this.saveMapping(input.aniListId, mapping?.id ?? null);
      if (!mapping) {
        return this.rememberReader(cacheKey, {
          status: "unmapped",
          aniListId: input.aniListId,
          translatedLanguage,
          availableLanguages: [],
          availableGroups: [],
          preferredGroupId,
          archiveStatus: "complete",
          chapters: [],
          message: "MangaDex has no exact AniList mapping for this title.",
        });
      }
      const [archive, statistics] = await Promise.all([
        this.getChapters(mapping.id, translatedLanguage, signal),
        this.getStatistics(mapping.id, signal),
      ]);
      const availableGroups = collectScanlationGroups(archive.chapters);
      return this.rememberReader(cacheKey, {
        status: "available",
        aniListId: input.aniListId,
        mangaDexId: mapping.id,
        publicationStatus: mapping.publicationStatus,
        translatedLanguage,
        availableLanguages: mapping.availableLanguages,
        availableGroups,
        preferredGroupId,
        archiveStatus: archive.complete ? "complete" : "partial",
        chapters: archive.chapters,
        externalChapters: archive.externalChapters,
        statistics,
        message: archive.chapters.length
          ? undefined
          : `No readable chapters are currently available in the chosen language (${translatedLanguage.toLocaleUpperCase()}).`,
      });
    } catch (error) {
      return {
        status: "unavailable",
        aniListId: input.aniListId,
        translatedLanguage,
        availableLanguages: [],
        availableGroups: [],
        preferredGroupId,
        archiveStatus: "partial",
        chapters: [],
        message: error instanceof Error ? error.message : "MangaDex is unavailable.",
      };
    }
  }

  /**
   * False only when MangaDex@Home has no allocation for the chapter (404), e.g. a listed chapter
   * whose images were never uploaded or were removed. Any other failure answers true so the normal
   * reader path reports it. The node is cached, so the first page load reuses this request.
   */
  public async isChapterReadable(chapterId: string): Promise<boolean> {
    if (!isSafeId(chapterId)) throw new Error("Invalid MangaDex chapter.");
    try {
      await this.getAtHomeNode(chapterId);
      return true;
    } catch (error) {
      return !(error instanceof MangaDexRequestError && error.status === 404);
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

    const existing = this.pageInFlight.get(cacheKey);
    if (existing) return existing;
    const request = this.loadPage(input, quality, cacheKey);
    this.pageInFlight.set(cacheKey, request);
    const clear = (): void => {
      if (this.pageInFlight.get(cacheKey) === request) this.pageInFlight.delete(cacheKey);
    };
    void request.then(clear, clear);
    return request;
  }

  private async loadPage(
    input: MangaDexPageInput,
    quality: "data" | "data-saver",
    cacheKey: string,
  ): Promise<MangaDexReaderPage> {
    let image: FetchedPageImage;
    try {
      image = await this.fetchPageImage(input.chapterId, input.page, quality);
      if (!image.imageBytes) {
        // MangaDex@Home nodes are temporary (403 once the base URL expires) and can be
        // unhealthy. The docs ask for a fresh node after any failed image, so retry once.
        this.atHomeCache.delete(atHomeCacheKey(input.chapterId, true));
        this.atHomeCache.delete(atHomeCacheKey(input.chapterId, false));
        image = await this.fetchPageImage(input.chapterId, input.page, quality);
      }
    } catch (error) {
      if (error instanceof MangaDexRequestError && error.status === 404) {
        throw new Error(
          "This chapter is hosted on an external publisher site or is no longer available through MangaDex@Home.",
          { cause: error },
        );
      }
      throw error;
    }
    const { files, imageBytes, mimeType, status } = image;
    if (!imageBytes) {
      throw new Error(
        status === 0
          ? "The MangaDex image server could not be reached."
          : status >= 200 && status < 300
            ? "MangaDex did not return an image."
            : `MangaDex page request failed (${status}).`,
      );
    }
    const page = {
      chapterId: input.chapterId,
      page: input.page,
      pageCount: files.length,
      mimeType,
      imageBytes,
    };
    this.pageCache.set(cacheKey, page);
    return page;
  }

  /** Fetches one page image and reports the outcome to MangaDex@Home. Never throws for image-host failures. */
  private async fetchPageImage(
    chapterId: string,
    page: number,
    quality: "data" | "data-saver",
  ): Promise<FetchedPageImage> {
    const node = await this.getAtHomeNode(chapterId);
    const files = quality === "data-saver" ? node.dataSaver : node.data;
    const filename = files[page];
    if (!filename) throw new Error("This MangaDex page does not exist.");
    const imageUrl = new URL(`${quality}/${node.hash}/${filename}`, `${node.baseUrl}/`);
    if (!imageUrl.toString().startsWith(`${node.baseUrl}/`)) {
      throw new Error("MangaDex returned an unsafe image URL.");
    }
    const startedAt = performance.now();
    let status = 0;
    let cached = false;
    let bytes = 0;
    let mimeType = "image/jpeg";
    let imageBytes: ArrayBuffer | undefined;
    try {
      const response = await this.fetcher(imageUrl, {
        headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      cached = response.headers.get("x-cache")?.toUpperCase().startsWith("HIT") ?? false;
      mimeType = response.headers.get("content-type")?.split(";")[0] || mimeType;
      const body = await response.arrayBuffer();
      bytes = body.byteLength;
      if (response.ok && mimeType.startsWith("image/")) imageBytes = body;
    } catch {
      // Connection, TLS, or timeout failure: reported below with zero bytes.
    }
    // The docs ask for a report for every image (success or failure) served from a base URL
    // outside mangadex.org, i.e. a volunteer MangaDex@Home node.
    if (!isMangaDexHost(node.baseUrl)) {
      this.reportAtHome({
        url: imageUrl.toString(),
        success: Boolean(imageBytes),
        cached,
        bytes,
        duration: Math.round(performance.now() - startedAt),
      });
    }
    return { status, mimeType, imageBytes, files };
  }

  /** Fire-and-forget MangaDex@Home health report; a failed report never affects reading. */
  private reportAtHome(report: AtHomeReport): void {
    void this.fetcher(AT_HOME_REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": PROVIDER_USER_AGENT },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(AT_HOME_REPORT_TIMEOUT_MS),
    })
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  }

  private async resolveAvailability(
    item: MangaDexAvailabilityInput,
  ): Promise<MangaDexChapterAvailability> {
    const translatedLanguage = normalizeLanguage(
      item.translatedLanguage ?? this.translatedLanguage,
    );
    const cacheKey = `${item.aniListId}:${translatedLanguage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const checkedAt = new Date().toISOString();
    try {
      const known = this.knownMapping(item.aniListId);
      let mangaDexId = known;
      if (mangaDexId === undefined) {
        mangaDexId = (await this.findMappedManga(item.aniListId, item.title))?.id ?? null;
        this.saveMapping(item.aniListId, mangaDexId);
      }
      if (mangaDexId === null) {
        return this.remember(cacheKey, {
          aniListId: item.aniListId,
          status: "unmapped",
          translatedLanguage,
          checkedAt,
          message: "No exact AniList ID mapping was found in MangaDex.",
        });
      }

      const aggregateUrl = new URL(`/manga/${mangaDexId}/aggregate`, MANGADEX_API_URL);
      aggregateUrl.searchParams.append("translatedLanguage[]", translatedLanguage);
      let aggregate: unknown;
      try {
        aggregate = await this.requestJson(aggregateUrl);
      } catch (error) {
        // A remembered title MangaDex no longer serves: drop it so the next check searches again.
        if (known && error instanceof MangaDexRequestError && error.status === 404) {
          this.options.mappingStore?.()?.forget(item.aniListId);
        }
        throw error;
      }
      return this.remember(cacheKey, {
        aniListId: item.aniListId,
        mangaDexId,
        status: "available",
        translatedLanguage,
        latestChapter: findLatestNumericChapter(aggregate),
        checkedAt,
      });
    } catch (error) {
      return {
        aniListId: item.aniListId,
        status: "unavailable",
        translatedLanguage,
        checkedAt,
        message: error instanceof Error ? error.message : "MangaDex is unavailable.",
      };
    }
  }

  /** A remembered exact mapping; a storage failure only means searching again. */
  private knownMapping(aniListId: number): string | null | undefined {
    try {
      return this.options.mappingStore?.()?.get(aniListId, Date.now());
    } catch {
      return undefined;
    }
  }

  private saveMapping(aniListId: number, mangaDexId: string | null): void {
    try {
      this.options.mappingStore?.()?.save(aniListId, mangaDexId, Date.now());
    } catch {
      // The mapping is an optimisation; the result is still returned.
    }
  }

  /**
   * MangaDex's title search can omit a title it still serves (seen 2026-10-06). When it does, an
   * external mapping may name candidate MangaDex IDs; each is fetched directly and accepted only
   * by the same exact `links.al` rule, so the hint never establishes identity on its own.
   * Used for an opened title only, never for library-wide availability batches.
   */
  private async findHintedManga(
    aniListId: number,
    signal?: AbortSignal,
  ): Promise<ExactMangaDexMapping | undefined> {
    const hint = this.options.mappingHint;
    if (!hint) return undefined;
    let candidates: string[];
    try {
      candidates = await hint(aniListId, signal);
    } catch {
      return undefined;
    }
    const records: unknown[] = [];
    for (const id of [...new Set(candidates)].filter(isSafeId).slice(0, MAX_HINTED_CANDIDATES)) {
      const url = new URL(`/manga/${id}`, MANGADEX_API_URL);
      try {
        const payload = await this.requestJson(url, signal);
        if (isRecord(payload) && isRecord(payload.data)) records.push(payload.data);
      } catch {
        // A stale or removed candidate is simply not a match.
      }
    }
    return findExactAniListManga({ data: records }, aniListId);
  }

  private async findMappedManga(
    aniListId: number,
    title: string,
    signal?: AbortSignal,
  ): Promise<ExactMangaDexMapping | undefined> {
    const searchUrl = new URL("/manga", MANGADEX_API_URL);
    searchUrl.searchParams.set("title", title);
    searchUrl.searchParams.set("limit", String(MAPPING_SEARCH_LIMIT));
    searchUrl.searchParams.set("order[relevance]", "desc");
    appendContentRatings(searchUrl);
    return findExactAniListManga(await this.requestJson(searchUrl, signal), aniListId);
  }

  private async getChapters(
    mangaDexId: string,
    translatedLanguage: string,
    signal?: AbortSignal,
  ): Promise<{
    chapters: MangaDexReaderChapter[];
    externalChapters: MangaExternalChapter[];
    complete: boolean;
  }> {
    const chapters = new Map<string, MangaDexReaderChapter>();
    const externalChapters = new Map<string, MangaExternalChapter>();
    let complete = true;
    const addBatch = (payload: unknown): void => {
      for (const chapter of normalizeChapters(payload)) {
        if (chapter.translatedLanguage === translatedLanguage) chapters.set(chapter.id, chapter);
      }
      for (const chapter of normalizeExternalChapters(payload)) {
        if (chapter.translatedLanguage === translatedLanguage)
          externalChapters.set(chapter.id, chapter);
      }
    };
    const fetchBatch = async (offset: number): Promise<unknown> => {
      const chaptersUrl = new URL(`/manga/${mangaDexId}/feed`, MANGADEX_API_URL);
      chaptersUrl.searchParams.append("translatedLanguage[]", translatedLanguage);
      appendContentRatings(chaptersUrl);
      chaptersUrl.searchParams.append("includes[]", "scanlation_group");
      chaptersUrl.searchParams.set("order[chapter]", "asc");
      chaptersUrl.searchParams.set("limit", String(CHAPTER_PAGE_LIMIT));
      chaptersUrl.searchParams.set("offset", String(offset));
      return this.requestJson(chaptersUrl, signal);
    };

    const firstPayload = await fetchBatch(0);
    addBatch(firstPayload);
    const firstBatchSize = readCollectionSize(firstPayload);
    const reportedTotal = readCollectionTotal(firstPayload);

    if (reportedTotal !== undefined) {
      const total = Math.min(reportedTotal, MAX_READER_CHAPTERS);
      if (reportedTotal > MAX_READER_CHAPTERS) complete = false;
      const offsets: number[] = [];
      for (let offset = firstBatchSize; offset < total; offset += CHAPTER_PAGE_LIMIT) {
        offsets.push(offset);
      }
      const batches = await mapSettledWithConcurrency(offsets, 3, fetchBatch);
      for (const batch of batches) {
        if (batch.status !== "fulfilled") {
          complete = false;
          continue;
        }
        const payload = batch.value;
        addBatch(payload);
      }
    } else {
      let offset = firstBatchSize;
      let batchSize = firstBatchSize;
      while (batchSize === CHAPTER_PAGE_LIMIT && offset < MAX_READER_CHAPTERS) {
        let payload: unknown;
        try {
          payload = await fetchBatch(offset);
        } catch {
          complete = false;
          break;
        }
        addBatch(payload);
        batchSize = readCollectionSize(payload);
        offset += batchSize;
      }
      if (batchSize === CHAPTER_PAGE_LIMIT && offset >= MAX_READER_CHAPTERS) complete = false;
    }

    return {
      chapters: [...chapters.values()].sort(compareChapterReleases),
      externalChapters: [...externalChapters.values()].sort(
        (left, right) => (left.number ?? Infinity) - (right.number ?? Infinity),
      ),
      complete,
    };
  }

  /** Optional community rating/follows; a failure here never blocks the chapter list. */
  private async getStatistics(
    mangaDexId: string,
    signal?: AbortSignal,
  ): Promise<MangaDexStatistics | undefined> {
    try {
      const url = new URL(`/statistics/manga/${mangaDexId}`, MANGADEX_API_URL);
      return parseMangaStatistics(await this.requestJson(url, signal), mangaDexId);
    } catch {
      return undefined;
    }
  }

  private async getAtHomeNode(chapterId: string): Promise<AtHomeNode> {
    const forcePort443 = this.options.forcePort443?.() ?? false;
    const cacheKey = atHomeCacheKey(chapterId, forcePort443);
    const cached = this.atHomeCache.get(cacheKey);
    if (cached) return cached;
    const url = new URL(`/at-home/server/${chapterId}`, MANGADEX_API_URL);
    // Some school/office networks block HTTPS on non-standard ports; MangaDex can pick 443-only nodes.
    if (forcePort443) url.searchParams.set("forcePort443", "true");
    const payload = await this.atHomeRequestGate.run(cacheKey, () => this.requestJson(url));
    const node = normalizeAtHomeNode(payload);
    this.atHomeCache.set(cacheKey, node);
    return node;
  }

  private async requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    return this.transport.requestParsed(
      url,
      {
        signal,
        onResponse: (providerResponse, gate) => {
          if (providerResponse.status >= 400) logFailedRequest(url, providerResponse);
          if (providerResponse.status === 429) {
            gate.reportRateLimited(
              parseRateLimitCooldownMs(
                providerResponse.headers.get("x-ratelimit-retry-after"),
                providerResponse.headers.get("retry-after"),
              ),
            );
            throw new Error(
              "MangaDex is rate-limiting requests. AniStream paused its request queue.",
            );
          }
          if (providerResponse.status === 403) {
            gate.reportRateLimited(FORBIDDEN_PAUSE_MS);
            throw new Error(
              "MangaDex temporarily refused requests. AniStream paused its request queue.",
            );
          }
        },
      },
      (response) => {
        if (!response.ok) {
          throw new MangaDexRequestError(
            response.status,
            `MangaDex request failed (${response.status}).`,
          );
        }
        return response.json() as Promise<unknown>;
      },
    );
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

export interface MangaDexClientOptions {
  /**
   * Candidate MangaDex IDs for an AniList ID from an external mapping (MAL-Sync), consulted only
   * when the title search finds no exact match. Candidates must still pass the `links.al` check.
   */
  mappingHint?: (aniListId: number, signal?: AbortSignal) => Promise<string[]>;
  /** Read on each MangaDex@Home allocation so a reader-setting change applies to the next chapter node. */
  forcePort443?: () => boolean;
  /**
   * Durable exact mappings (absent until the database opens). Availability batches reuse them to
   * skip the title search; the reader still verifies `links.al` on every open and refreshes them.
   */
  mappingStore?: () => MangaDexMappingStore | undefined;
}

/** True only for mangadex.org itself or its subdomains, judged by the parsed hostname. */
export function isMangaDexHost(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "mangadex.org" || hostname.endsWith(".mangadex.org");
  } catch {
    return false;
  }
}

function atHomeCacheKey(chapterId: string, forcePort443: boolean): string {
  return forcePort443 ? `${chapterId}:443` : chapterId;
}

interface FetchedPageImage {
  /** HTTP status of the image response; 0 when the image host could not be reached. */
  status: number;
  mimeType: string;
  /** Present only for a successful image response. */
  imageBytes?: ArrayBuffer;
  files: string[];
}

interface AtHomeReport {
  url: string;
  success: boolean;
  cached: boolean;
  bytes: number;
  duration: number;
}

interface ExactMangaDexMapping {
  id: string;
  publicationStatus?: "ongoing" | "completed" | "hiatus" | "cancelled";
  availableLanguages: string[];
}

class MangaDexRequestError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MangaDexRequestError";
  }
}

export function parseMangaStatistics(
  payload: unknown,
  mangaDexId: string,
): MangaDexStatistics | undefined {
  if (!isRecord(payload) || !isRecord(payload.statistics)) return undefined;
  const entry = payload.statistics[mangaDexId];
  if (!isRecord(entry)) return undefined;
  const bayesian = isRecord(entry.rating) ? entry.rating.bayesian : undefined;
  const rating =
    typeof bayesian === "number" && Number.isFinite(bayesian) && bayesian > 0 && bayesian <= 10
      ? Math.round(bayesian * 100) / 100
      : undefined;
  const follows =
    Number.isInteger(entry.follows) && Number(entry.follows) >= 0
      ? Number(entry.follows)
      : undefined;
  return rating === undefined && follows === undefined ? undefined : { rating, follows };
}

export function normalizeChapters(payload: unknown): MangaDexReaderChapter[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const chapters = payload.data
    .map((item): MangaDexReaderChapter | undefined => {
      if (!isRecord(item) || !isSafeId(item.id) || !isRecord(item.attributes)) return undefined;
      const attributes = item.attributes;
      if (typeof attributes.translatedLanguage !== "string") return undefined;
      if (typeof attributes.externalUrl === "string" && attributes.externalUrl.trim()) {
        return undefined;
      }
      const pages = typeof attributes.pages === "number" ? attributes.pages : 0;
      if (!Number.isInteger(pages) || pages <= 0) return undefined;
      const groups = findScanlationGroups(item.relationships);
      return {
        id: item.id,
        number: parseChapterNumber(attributes.chapter),
        volume: typeof attributes.volume === "string" ? attributes.volume : undefined,
        title: typeof attributes.title === "string" ? attributes.title : undefined,
        translatedLanguage: attributes.translatedLanguage,
        groups,
        groupName: groups[0]?.name,
        publishedAt: typeof attributes.publishAt === "string" ? attributes.publishAt : undefined,
        pages,
      };
    })
    .filter((chapter): chapter is MangaDexReaderChapter => Boolean(chapter));
  return chapters.sort(compareChapterReleases);
}

/**
 * Chapters MangaDex lists only as an official publisher link (`externalUrl`). They have no
 * MangaDex@Home pages, so they are kept apart from the readable chapter list.
 */
export function normalizeExternalChapters(payload: unknown): MangaExternalChapter[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): MangaExternalChapter[] => {
    if (!isRecord(item) || !isSafeId(item.id) || !isRecord(item.attributes)) return [];
    const attributes = item.attributes;
    if (typeof attributes.translatedLanguage !== "string") return [];
    let url: URL;
    try {
      url = new URL(String(attributes.externalUrl ?? ""));
    } catch {
      return [];
    }
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2_048)
      return [];
    return [
      {
        id: item.id,
        number: parseChapterNumber(attributes.chapter),
        title:
          typeof attributes.title === "string" && attributes.title.trim()
            ? attributes.title.trim().slice(0, 200)
            : undefined,
        url: url.toString(),
        site: url.hostname.replace(/^www\./, ""),
        translatedLanguage: attributes.translatedLanguage,
        publishedAt: typeof attributes.publishAt === "string" ? attributes.publishAt : undefined,
      },
    ];
  });
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

/**
 * Parses the /manga listing (ordered by latestUploadedChapter) into display rows.
 * Cover art comes from the included cover_art relationship's static CDN path;
 * the optional AniList mapping uses the same exact attributes.links.al rule as
 * availability mapping — never title similarity.
 */
export function parseLatestMangaUpdates(payload: unknown): LatestMangaUpdate[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((value): LatestMangaUpdate[] => {
    if (!isRecord(value) || !isSafeId(value.id)) return [];
    const attributes = value.attributes;
    if (!isRecord(attributes)) return [];

    const title = readLocalizedTitle(attributes.title);
    if (!title) return [];

    const aniListRaw = isRecord(attributes.links) ? attributes.links.al : undefined;
    const aniListId =
      typeof aniListRaw === "string" && /^\d{1,10}$/.test(aniListRaw)
        ? Number(aniListRaw)
        : undefined;
    const malRaw = isRecord(attributes.links) ? attributes.links.mal : undefined;
    const malId =
      (typeof malRaw === "string" || typeof malRaw === "number") &&
      /^\d{1,10}$/.test(String(malRaw))
        ? Number(malRaw)
        : undefined;
    const originalLanguage =
      typeof attributes.originalLanguage === "string" ? attributes.originalLanguage : undefined;

    const updatedAt = typeof attributes.updatedAt === "string" ? attributes.updatedAt : undefined;
    if (!updatedAt) return [];

    const coverFileName = findCoverFileName(value.relationships);
    const coverBase = coverFileName
      ? `https://uploads.mangadex.org/covers/${value.id}/${coverFileName}`
      : undefined;
    return [
      {
        mangaDexId: value.id,
        aniListId,
        malId,
        title,
        coverUrl: coverBase ? `${coverBase}.512.jpg` : undefined,
        coverUrlFallback: coverBase,
        originalLanguage,
        publicationKind: mangaKindFromOriginalLanguage(originalLanguage) ?? "OTHER",
        updatedAt,
        mangaDexUrl: `https://mangadex.org/title/${value.id}`,
      },
    ];
  });
}

export function parseMangaDexPageInfo(
  payload: unknown,
  requestedPage: number,
  perPage: number,
): LatestUpdatesPage<never>["pageInfo"] {
  const record = isRecord(payload) ? payload : {};
  const total =
    typeof record.total === "number" && Number.isFinite(record.total) && record.total >= 0
      ? record.total
      : 0;
  const offset =
    typeof record.offset === "number" && Number.isFinite(record.offset) && record.offset >= 0
      ? record.offset
      : (requestedPage - 1) * perPage;
  return {
    currentPage: requestedPage,
    perPage,
    lastPage: Math.max(requestedPage, Math.max(1, Math.ceil(total / perPage))),
    hasNextPage: total > 0 ? offset + perPage < total : false,
  };
}

export function findLatestChapterIds(payload: unknown): Map<string, string> {
  const ids = new Map<string, string>();
  if (!isRecord(payload) || !Array.isArray(payload.data)) return ids;
  for (const value of payload.data) {
    if (!isRecord(value) || !isSafeId(value.id) || !isRecord(value.attributes)) continue;
    const chapterId = value.attributes.latestUploadedChapter;
    if (isSafeId(chapterId)) ids.set(value.id, chapterId);
  }
  return ids;
}

export function mergeLatestChapterDetails(
  items: LatestMangaUpdate[],
  chapterIds: ReadonlyMap<string, string>,
  payload: unknown,
): LatestMangaUpdate[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return items;
  const details = new Map<string, { chapter?: string; updatedAt?: string }>();
  for (const value of payload.data) {
    if (!isRecord(value) || !isSafeId(value.id) || !isRecord(value.attributes)) continue;
    const attributes = value.attributes;
    const chapter =
      typeof attributes.chapter === "string" && attributes.chapter.trim()
        ? attributes.chapter.trim()
        : undefined;
    const updatedAt =
      typeof attributes.publishAt === "string"
        ? attributes.publishAt
        : typeof attributes.readableAt === "string"
          ? attributes.readableAt
          : undefined;
    details.set(value.id, { chapter, updatedAt });
  }
  return items.map((item) => {
    const chapterId = chapterIds.get(item.mangaDexId);
    const detail = chapterId ? details.get(chapterId) : undefined;
    return detail
      ? {
          ...item,
          chapter: detail.chapter,
          updatedAt: detail.updatedAt ?? item.updatedAt,
        }
      : item;
  });
}

function readLocalizedTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const preferred = value.en ?? value["ja-ro"] ?? Object.values(value)[0];
  return typeof preferred === "string" && preferred.trim() ? preferred.trim() : undefined;
}

function findCoverFileName(relationships: unknown): string | undefined {
  if (!Array.isArray(relationships)) return undefined;
  for (const relationship of relationships) {
    if (!isRecord(relationship) || relationship.type !== "cover_art") continue;
    const attributes = relationship.attributes;
    if (!isRecord(attributes)) continue;
    const fileName = attributes.fileName;
    if (typeof fileName === "string" && /^[\w.-]{1,200}$/.test(fileName)) return fileName;
  }
  return undefined;
}

export function findExactAniListMapping(payload: unknown, aniListId: number): string | undefined {
  return findExactAniListManga(payload, aniListId)?.id;
}

function findExactAniListManga(
  payload: unknown,
  aniListId: number,
): ExactMangaDexMapping | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const matches = new Map<string, ExactMangaDexMapping>();
  for (const candidate of payload.data) {
    // The ID is later placed in a request path (/manga/{id}/feed), so it must be a plain ID.
    if (!isRecord(candidate) || !isSafeId(candidate.id)) continue;
    const attributes = candidate.attributes;
    if (!isRecord(attributes) || !isRecord(attributes.links)) continue;
    if (String(attributes.links.al) !== String(aniListId)) continue;
    matches.set(candidate.id, {
      id: candidate.id,
      publicationStatus: readPublicationStatus(attributes.status),
      availableLanguages: readAvailableLanguages(attributes.availableTranslatedLanguages),
    });
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
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

function appendContentRatings(url: URL): void {
  for (const rating of CONTENT_RATINGS) url.searchParams.append("contentRating[]", rating);
}

/**
 * MangaDex asks bug reports to include the response's `X-Request-ID`. Logged in the main process
 * only; the path is logged without the query so manga titles from searches stay out of the log.
 */
function logFailedRequest(url: URL, response: Response): void {
  const requestId = response.headers.get("x-request-id") ?? "none";
  console.warn(
    `MangaDex request failed: ${response.status} ${url.pathname} (X-Request-ID: ${requestId})`,
  );
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

function readCollectionSize(payload: unknown): number {
  return isRecord(payload) && Array.isArray(payload.data) ? payload.data.length : 0;
}

function readCollectionTotal(payload: unknown): number | undefined {
  return isRecord(payload) && Number.isInteger(payload.total) && Number(payload.total) >= 0
    ? Number(payload.total)
    : undefined;
}

function readPublicationStatus(value: unknown): ExactMangaDexMapping["publicationStatus"] {
  return value === "ongoing" || value === "completed" || value === "hiatus" || value === "cancelled"
    ? value
    : undefined;
}

function parseChapterNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function findScanlationGroups(relationships: unknown): MangaDexScanlationGroup[] {
  if (!Array.isArray(relationships)) return [];
  const groups = new Map<string, MangaDexScanlationGroup>();
  for (const relationship of relationships) {
    if (
      !isRecord(relationship) ||
      relationship.type !== "scanlation_group" ||
      !isSafeId(relationship.id)
    ) {
      continue;
    }
    if (!isRecord(relationship.attributes)) continue;
    const name = relationship.attributes.name;
    if (typeof name === "string" && name.trim()) {
      groups.set(relationship.id, { id: relationship.id, name: name.trim() });
    }
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectScanlationGroups(
  chapters: readonly MangaDexReaderChapter[],
): MangaDexScanlationGroup[] {
  const groups = new Map<string, MangaDexScanlationGroup>();
  for (const chapter of chapters) {
    for (const group of chapter.groups) groups.set(group.id, group);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readAvailableLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLocaleLowerCase())
        .filter(isMangaLanguage),
    ),
  ].sort();
}

/**
 * Offered languages only (English/Japanese). Anything else, such as a preference saved before the
 * restriction, falls back to English instead of failing the request.
 */
function normalizeLanguage(value: string): string {
  return toMangaLanguage(value);
}

function compareChapterReleases(left: MangaDexReaderChapter, right: MangaDexReaderChapter): number {
  const number = (left.number ?? Infinity) - (right.number ?? Infinity);
  if (number) return number;
  const volume = (left.volume ?? "").localeCompare(right.volume ?? "", undefined, {
    numeric: true,
  });
  if (volume) return volume;
  const published = (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
  return published || left.id.localeCompare(right.id);
}
