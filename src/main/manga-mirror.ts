import type {
  MangaDexReaderChapter,
  MangaDexReaderPage,
  MangaDexReaderSession,
  MangaMirrorChapterInfo,
  MangaMirrorPageInput,
} from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import type { MalSyncMapping } from "./malsync";
import { pickMalSyncPage } from "./malsync";
import { fillUrlTemplate, type MangaChapterMirrorProvider } from "./provider-config";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

const REQUEST_TIMEOUT_MS = 20_000;
// The mirror publishes no limits; these are conservative application policies.
const PAGE_REQUESTS_PER_SECOND = 1;
const IMAGE_REQUESTS_PER_SECOND = 4;
const REFUSED_PAUSE_MS = 5 * 60_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_CHAPTERS = 5_000;
const MAX_PAGES = 400;
/** Mirror chapters are English scanlations; they only fill English reading sessions. */
export const MIRROR_LANGUAGE = "en";

type Fetcher = typeof fetch;

/** One chapter as the mirror lists it. */
export interface MirrorChapter {
  id: string;
  number?: number;
  label: string;
  publishedAt?: string;
}

export interface MangaMirrorDeps {
  mapping: {
    getSitePages(aniListId: number, site: string, signal?: AbortSignal): Promise<MalSyncMapping>;
  };
  fetcher?: Fetcher;
}

/**
 * Removable, user-approved chapter mirror (scraped HTML, approved 2026-10-03). It fills English
 * chapter numbers MangaDex lacks so they can be read in-app. Requests use AniStream's truthful
 * User-Agent and no Referer, cookies, or other borrowed headers; 403/429 pause the queue. Failures
 * never affect MangaDex: callers treat every error as "no mirror chapters".
 */
export class MangaMirrorClient {
  private readonly pageGate: RequestGate = createRequestGate({
    requestsPerMinute: PAGE_REQUESTS_PER_SECOND,
    windowMs: 1_000,
  });
  private readonly imageGate: RequestGate = createRequestGate({
    requestsPerMinute: IMAGE_REQUESTS_PER_SECOND,
    windowMs: 1_000,
  });
  private readonly chapterListCache = createBoundedCache<MirrorChapter[]>({
    maxEntries: 40,
    ttlMs: 30 * 60_000,
  });
  private readonly pageListCache = createBoundedCache<string[]>({
    maxEntries: 40,
    ttlMs: 15 * 60_000,
  });
  private readonly imageCache = createBoundedCache<MangaDexReaderPage>({
    maxEntries: 18,
    maxBytes: 32 * 1024 * 1024,
    sizeOf: (page) => page.imageBytes.byteLength,
    ttlMs: 15 * 60_000,
  });
  private readonly transport: ProviderTransport;
  private readonly fetcher: Fetcher;

  public constructor(
    private readonly config: MangaChapterMirrorProvider,
    private readonly deps: MangaMirrorDeps,
  ) {
    this.fetcher = deps.fetcher ?? fetch;
    this.transport = new ProviderTransport({
      gate: this.pageGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      // Redirects are not followed, so a moved page can never pull requests to another host.
      redirect: "manual",
      headers: { Accept: "text/html", "User-Agent": PROVIDER_USER_AGENT },
    });
  }

  public get label(): string {
    return this.config.label;
  }

  /** The mirror's chapters for an exact AniList ID; empty when unmapped or ambiguous. */
  public async getChapters(aniListId: number, signal?: AbortSignal): Promise<MirrorChapter[]> {
    const mapping = await this.deps.mapping.getSitePages(
      aniListId,
      this.config.mappingSite,
      signal,
    );
    const series = pickMalSyncPage(mapping);
    if (!series) return [];
    const seriesId = series.identifier.toUpperCase();
    const cached = this.chapterListCache.get(seriesId);
    if (cached) return cached;
    const url = new URL(fillUrlTemplate(this.config.chapterListUrl, { seriesId }));
    const chapters = parseMirrorChapterList(await this.requestHtml(url, signal));
    this.chapterListCache.set(seriesId, chapters);
    return chapters;
  }

  public async getChapterInfo(chapterId: string): Promise<MangaMirrorChapterInfo> {
    const pages = await this.getPageUrls(chapterId);
    return { chapterId, pageCount: pages.length };
  }

  public async getPage(input: MangaMirrorPageInput): Promise<MangaDexReaderPage> {
    const cacheKey = `${input.chapterId}:${input.page}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) return cached;
    const pages = await this.getPageUrls(input.chapterId);
    const imageUrl = pages[input.page];
    if (!imageUrl) throw new Error("This chapter page does not exist.");
    const page = await this.imageGate.run(imageUrl, async () => {
      const response = await this.fetcher(imageUrl, {
        headers: {
          Accept: "image/avif,image/webp,image/*;q=0.8",
          "User-Agent": PROVIDER_USER_AGENT,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status === 403) {
        this.imageGate.reportRateLimited(REFUSED_PAUSE_MS);
        throw new Error(`${this.config.label} refused the page image (${response.status}).`);
      }
      if (!response.ok) throw new Error(`${this.config.label} page failed (${response.status}).`);
      const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!mimeType.startsWith("image/")) throw new Error("The mirror did not return an image.");
      if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES)
        throw new Error("The mirror page image is too large.");
      const imageBytes = await response.arrayBuffer();
      if (imageBytes.byteLength > MAX_IMAGE_BYTES)
        throw new Error("The mirror page image is too large.");
      return {
        chapterId: input.chapterId,
        page: input.page,
        pageCount: pages.length,
        mimeType,
        imageBytes,
      } satisfies MangaDexReaderPage;
    });
    this.imageCache.set(cacheKey, page);
    return page;
  }

  private async getPageUrls(chapterId: string): Promise<string[]> {
    const cached = this.pageListCache.get(chapterId);
    if (cached) return cached;
    const url = new URL(fillUrlTemplate(this.config.chapterPagesUrl, { chapterId }));
    const pages = parseMirrorPageImages(await this.requestHtml(url), this.config.imageHosts);
    if (!pages.length) throw new Error(`${this.config.label} listed no pages for this chapter.`);
    this.pageListCache.set(chapterId, pages);
    return pages;
  }

  private requestHtml(url: URL, signal?: AbortSignal): Promise<string> {
    return this.transport.requestParsed(
      url,
      {
        signal,
        onResponse: (response, gate) => {
          if (response.status === 429 || response.status === 403) {
            gate.reportRateLimited(REFUSED_PAUSE_MS);
            throw new Error(
              `${this.config.label} temporarily refused requests (${response.status}).`,
            );
          }
        },
      },
      async (response) => {
        if (!response.ok)
          throw new Error(`${this.config.label} request failed (${response.status}).`);
        if (Number(response.headers.get("content-length") ?? 0) > MAX_HTML_BYTES)
          throw new Error(`${this.config.label} returned an oversized page.`);
        const html = await response.text();
        if (html.length > MAX_HTML_BYTES)
          throw new Error(`${this.config.label} returned an oversized page.`);
        return html;
      },
    );
  }
}

/**
 * Parses the mirror's chapter-list HTML (anchor per chapter with a "Chapter N" label and a time).
 * Only English labels count: some series are hosted as other-language scans (e.g. "Kapitel 5"),
 * and the mirror only fills English reading sessions.
 */
/** "Chapter 12", "Ch. 12.5", "Episode 3" anywhere in a label. */
const CHAPTER_LABEL = /\b(?:chapter|ch\.?|episode)\s*(\d{1,5}(?:\.\d{1,3})?)\b/i;
/**
 * A series' own chapter naming, e.g. "Punch 196", "Official Scans 12", "Mag Version 240": a short
 * English name followed only by the chapter number.
 */
const NAMED_CHAPTER_LABEL = /^([A-Za-z][A-Za-z' -]{0,30}?)\s*#?(\d{1,5}(?:\.\d{1,3})?)$/;
/**
 * Numbered labels that are not regular English chapters: volumes, extras, separately numbered
 * editions (webcomic), and non-English chapter words such as German "Kapitel".
 */
const NOT_A_CHAPTER =
  /\b(?:vol(?:ume)?|side ?story|extra|special|bonus|omake|one-?shot|illustrations?|art(?:work)?|notice|announcement|preview|spin-?off|webcomic|web ?comic|kapitel|cap[ií]tulo|capitolo|chapitre|hoofdstuk|rozdzia[lł])\b/i;
/** Alternate releases of a chapter; the standard release of the same number is preferred. */
const VARIANT_CHAPTER = /\b(?:mag(?:azine)? version|re-?draw|raw|colou?red)\b/i;

/** The chapter number a mirror label names, or undefined for anything that is not a chapter. */
function chapterNumberFromLabel(label: string): number | undefined {
  const explicit = CHAPTER_LABEL.exec(label)?.[1];
  if (explicit) return Number(explicit);
  if (NOT_A_CHAPTER.test(label)) return undefined;
  const named = NAMED_CHAPTER_LABEL.exec(label)?.[2];
  return named ? Number(named) : undefined;
}

export function parseMirrorChapterList(html: string): MirrorChapter[] {
  const chapters = new Map<string, MirrorChapter & { variant: boolean }>();
  const anchor =
    /<a\b[^>]*\bhref="(?:https:\/\/[^"/]+)?\/chapters\/([A-Za-z0-9]{10,64})"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(anchor)) {
    const id = match[1]!.toUpperCase();
    if (chapters.has(id)) continue;
    const body = match[2]!;
    let label: string | undefined;
    let number: number | undefined;
    for (const span of body.matchAll(/<span\b[^>]*>([^<]+)<\/span>/g)) {
      const text = decodeEntities(span[1]!).replace(/\s+/g, " ").trim();
      const parsed = text ? chapterNumberFromLabel(text) : undefined;
      if (parsed !== undefined && Number.isFinite(parsed)) {
        label = text;
        number = parsed;
        break;
      }
    }
    if (!label) continue;
    const datetime = /<time\b[^>]*\bdatetime="([^"]{10,40})"/.exec(body)?.[1];
    chapters.set(id, {
      id,
      number,
      label: label.slice(0, 120),
      publishedAt: datetime && !Number.isNaN(Date.parse(datetime)) ? datetime : undefined,
      variant: VARIANT_CHAPTER.test(label),
    });
    if (chapters.size >= MAX_CHAPTERS) break;
  }
  // Callers keep the first copy of each number, so standard releases go ahead of variants.
  return [...chapters.values()]
    .sort((left, right) => Number(left.variant) - Number(right.variant))
    .map(({ variant: _variant, ...chapter }) => chapter);
}

/** Parses page images (`<img src=… alt="Page N">`) in reading order, keeping only safe image URLs. */
export function parseMirrorPageImages(html: string, imageHosts?: readonly string[]): string[] {
  const pages: string[] = [];
  for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
    const markup = tag[0];
    if (!/\balt="Page \d{1,4}"/.test(markup)) continue;
    const src = /\bsrc="([^"]{1,2048})"/.exec(markup)?.[1];
    const url = src ? safeImageUrl(decodeEntities(src), imageHosts) : undefined;
    if (url && !pages.includes(url)) pages.push(url);
    if (pages.length >= MAX_PAGES) break;
  }
  return pages;
}

/**
 * Accepts only credential-free https URLs on a public host name (no IP literals or local names),
 * optionally restricted to the configured image hosts and their subdomains.
 */
export function safeImageUrl(value: string, imageHosts?: readonly string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[") ||
    /(^|\.)(localhost|local|internal|lan|home|test)$/.test(host)
  )
    return undefined;
  if (imageHosts && !imageHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)))
    return undefined;
  return url.toString();
}

/**
 * Adds mirror chapters whose numbers MangaDex does not serve in the reader's language (English
 * only). MangaDex chapters are never replaced or reordered relative to each other.
 */
export function mergeMirrorChapters(input: {
  aniListId: number;
  reader?: MangaDexReaderSession;
  mirror: readonly MirrorChapter[];
  label: string;
}): MangaDexReaderSession | undefined {
  const { reader, label } = input;
  const language = reader?.translatedLanguage ?? MIRROR_LANGUAGE;
  if (language !== MIRROR_LANGUAGE) return reader;
  const hosted = reader?.status === "available" ? reader.chapters : [];
  const covered = new Set(
    hosted.flatMap((chapter) => (chapter.number === undefined ? [] : [chapter.number])),
  );
  const seen = new Set<number>();
  const added = input.mirror.flatMap((chapter): MangaDexReaderChapter[] => {
    if (chapter.number === undefined || covered.has(chapter.number) || seen.has(chapter.number))
      return [];
    seen.add(chapter.number);
    return [
      {
        id: chapter.id,
        number: chapter.number,
        translatedLanguage: MIRROR_LANGUAGE,
        groups: [],
        publishedAt: chapter.publishedAt,
        pages: 0,
        source: "mirror",
        sourceLabel: label,
      },
    ];
  });
  // MangaDex chapters the mirror also has can fall back to it if MangaDex cannot serve them.
  const mirrorByNumber = new Map<number, string>();
  for (const chapter of input.mirror)
    if (chapter.number !== undefined && !mirrorByNumber.has(chapter.number))
      mirrorByNumber.set(chapter.number, chapter.id);
  const withFallback = hosted.map((chapter) => {
    const mirrorId = chapter.number === undefined ? undefined : mirrorByNumber.get(chapter.number);
    return mirrorId
      ? { ...chapter, mirrorFallback: { id: mirrorId, sourceLabel: label } }
      : chapter;
  });
  if (!added.length && withFallback.every((chapter, index) => chapter === hosted[index]))
    return reader;
  const chapters = [...withFallback, ...added].sort(
    (left, right) => (left.number ?? Infinity) - (right.number ?? Infinity),
  );
  if (reader?.status === "available") {
    return {
      ...reader,
      chapters,
      // "No readable chapters in this language" no longer applies once the mirror fills it.
      message: reader.chapters.length ? reader.message : undefined,
    };
  }
  // MangaDex is unmapped or failed: the mirror alone still makes the title readable in-app.
  return {
    status: "available",
    aniListId: input.aniListId,
    translatedLanguage: MIRROR_LANGUAGE,
    availableLanguages: [MIRROR_LANGUAGE],
    availableGroups: [],
    preferredGroupId: reader?.preferredGroupId,
    archiveStatus: "complete",
    chapters,
    message:
      reader?.status === "unavailable"
        ? `MangaDex could not load chapters, so only ${label} chapters are listed.`
        : undefined,
  };
}

function decodeEntities(value: string): string {
  // `&amp;` last, so an escaped entity such as `&amp;lt;` is not decoded twice.
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
