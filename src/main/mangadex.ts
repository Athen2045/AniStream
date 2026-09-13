import type {
  LatestMangaUpdate,
  LatestUpdatesPage,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderChapter,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaDexReaderSession,
  MangaDexScanlationGroup,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { mangaKindFromOriginalLanguage } from "./manga-kind";
import { mapSettledWithConcurrency, ProviderTransport } from "./provider-transport";

const MANGADEX_API_URL = "https://api.mangadex.org";
const DEFAULT_LANGUAGE = "en";
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;
const FORBIDDEN_PAUSE_MS = 5 * 60_000;
const AT_HOME_CACHE_TTL_MS = 15 * 60_000;
const PAGE_CACHE_MAX_ENTRIES = 18;
// New chapter uploads land continuously; refetch the "latest updates" rail at most
// every 5 minutes to stay polite to MangaDex.
const LATEST_UPDATES_TTL_MS = 5 * 60_000;
const LATEST_UPDATES_LIMIT = 21;
const CHAPTER_PAGE_LIMIT = 100;
const MAX_READER_CHAPTERS = 2_000;
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
    private readonly translatedLanguage = process.env.MANGADEX_LANGUAGE?.trim() || DEFAULT_LANGUAGE,
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
    // All four ratings requested explicitly: MangaDex's API default excludes
    // pornographic, and the user directed that adult content must not be filtered
    // (2026-07-29).
    url.searchParams.append("contentRating[]", "safe");
    url.searchParams.append("contentRating[]", "suggestive");
    url.searchParams.append("contentRating[]", "erotica");
    url.searchParams.append("contentRating[]", "pornographic");
    url.searchParams.append("availableTranslatedLanguage[]", this.translatedLanguage);

    const payload = await this.requestJson(url);
    let items = parseLatestMangaUpdates(payload);
    const chapterIds = findLatestChapterIds(payload);
    if (chapterIds.size) {
      const chapterUrl = new URL("/chapter", MANGADEX_API_URL);
      chapterUrl.searchParams.set("limit", String(Math.min(100, chapterIds.size)));
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
      const mapping = await this.findMappedManga(input.aniListId, input.title, signal);
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
      const archive = await this.getChapters(mapping.id, translatedLanguage, signal);
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
    let image: { response: Response; files: string[] };
    try {
      image = await this.fetchPageImage(input.chapterId, input.page, quality);
      if (image.response.status === 404 || image.response.status === 410) {
        // MangaDex@Home nodes are temporary. Refresh the scoped chapter node once
        // when a cached image host says the resource has moved or expired.
        this.atHomeCache.delete(input.chapterId);
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
    const { response, files } = image;
    if (!response.ok) throw new Error(`MangaDex page request failed (${response.status}).`);
    const mime = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!mime.startsWith("image/")) throw new Error("MangaDex did not return an image.");
    const imageBytes = await response.arrayBuffer();
    const page = {
      chapterId: input.chapterId,
      page: input.page,
      pageCount: files.length,
      mimeType: mime,
      imageBytes,
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
    const translatedLanguage = normalizeLanguage(
      item.translatedLanguage ?? this.translatedLanguage,
    );
    const cacheKey = `${item.aniListId}:${translatedLanguage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const checkedAt = new Date().toISOString();
    try {
      const mapping = await this.findMappedManga(item.aniListId, item.title);
      if (!mapping) {
        return this.remember(cacheKey, {
          aniListId: item.aniListId,
          status: "unmapped",
          translatedLanguage,
          checkedAt,
          message: "No exact AniList ID mapping was found in MangaDex.",
        });
      }

      const aggregateUrl = new URL(`/manga/${mapping.id}/aggregate`, MANGADEX_API_URL);
      aggregateUrl.searchParams.append("translatedLanguage[]", translatedLanguage);
      const aggregate = await this.requestJson(aggregateUrl);
      return this.remember(cacheKey, {
        aniListId: item.aniListId,
        mangaDexId: mapping.id,
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

  private async findMappedManga(
    aniListId: number,
    title: string,
    signal?: AbortSignal,
  ): Promise<ExactMangaDexMapping | undefined> {
    const searchUrl = new URL("/manga", MANGADEX_API_URL);
    searchUrl.searchParams.set("title", title);
    searchUrl.searchParams.set("limit", "10");
    return findExactAniListManga(await this.requestJson(searchUrl, signal), aniListId);
  }

  private async getChapters(
    mangaDexId: string,
    translatedLanguage: string,
    signal?: AbortSignal,
  ): Promise<{ chapters: MangaDexReaderChapter[]; complete: boolean }> {
    const chapters = new Map<string, MangaDexReaderChapter>();
    let complete = true;
    const addBatch = (payload: unknown): void => {
      for (const chapter of normalizeChapters(payload)) {
        if (chapter.translatedLanguage === translatedLanguage) chapters.set(chapter.id, chapter);
      }
    };
    const fetchBatch = async (offset: number): Promise<unknown> => {
      const chaptersUrl = new URL("/chapter", MANGADEX_API_URL);
      chaptersUrl.searchParams.set("manga", mangaDexId);
      chaptersUrl.searchParams.append("translatedLanguage[]", translatedLanguage);
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
      complete,
    };
  }

  private async getAtHomeNode(chapterId: string): Promise<AtHomeNode> {
    const cached = this.atHomeCache.get(chapterId);
    if (cached) return cached;
    const url = new URL(`/at-home/server/${chapterId}`, MANGADEX_API_URL);
    const payload = await this.atHomeRequestGate.run(chapterId, () => this.requestJson(url));
    const node = normalizeAtHomeNode(payload);
    this.atHomeCache.set(chapterId, node);
    return node;
  }

  private async requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    return this.transport.requestParsed(
      url,
      {
        signal,
        onResponse: (providerResponse, gate) => {
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
    if (!isRecord(candidate) || typeof candidate.id !== "string") continue;
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
        .filter(isLanguage),
    ),
  ].sort();
}

function normalizeLanguage(value: string): string {
  const language = value.trim().toLocaleLowerCase();
  if (!isLanguage(language)) throw new Error("Invalid MangaDex translation language.");
  return language;
}

function isLanguage(value: string): boolean {
  return /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(value);
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
