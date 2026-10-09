import type {
  MangaChapterFallback,
  MangaChapterRange,
  MangaDexReaderSession,
  MangaEnrichment,
  MangaReadingLink,
} from "../shared/contracts";

/** Upper bound for the chapter total used to compute gaps; protects against bad provider data. */
const MAX_TOTAL_CHAPTERS = 5_000;
const MAX_READING_LINKS = 6;

/**
 * Builds the per-title chapter fallback. MangaDex stays the in-app source; everything here opens
 * on an official site in the browser:
 * 1. chapters MangaDex lists only as publisher links, for numbers it cannot serve in-app;
 * 2. whole-number ranges that neither of those covers, up to MangaBaka's exact-ID chapter total,
 *    paired with MangaBaka's official reading sites in the chosen language.
 * Identity comes only from the exact AniList ID both providers already matched.
 */
export function buildMangaChapterFallback(input: {
  reader?: MangaDexReaderSession;
  enrichment?: MangaEnrichment;
  /** Used when MangaDex did not answer; normally the reader's chosen language. */
  defaultLanguage: string;
}): MangaChapterFallback | undefined {
  const { reader } = input;
  const enrichment = input.enrichment?.status === "available" ? input.enrichment : undefined;
  const translatedLanguage = (reader?.translatedLanguage ?? input.defaultLanguage).toLowerCase();

  const hosted = new Set(
    (reader?.chapters ?? []).flatMap((chapter) =>
      chapter.number === undefined ? [] : [chapter.number],
    ),
  );
  const seenExternal = new Set<number>();
  const externalChapters = (reader?.externalChapters ?? []).filter((chapter) => {
    if (chapter.translatedLanguage.toLowerCase() !== translatedLanguage) return false;
    if (chapter.number === undefined) return true;
    if (hosted.has(chapter.number) || seenExternal.has(chapter.number)) return false;
    seenExternal.add(chapter.number);
    return true;
  });

  // One link per site; MangaBaka lists reading platforms before publisher pages.
  const seenSites = new Set<string>();
  const readingLinks = (enrichment?.readingLinks ?? [])
    .filter((link) => matchesLanguage(link.language, translatedLanguage))
    .filter((link) => !seenSites.has(link.site) && Boolean(seenSites.add(link.site)))
    .slice(0, MAX_READING_LINKS);
  // Prefer the provider's display name for publisher hosts MangaDex links to.
  const siteNames = new Map(readingLinks.map((link) => [hostOf(link.url), link.site]));
  const namedExternal = externalChapters.map((chapter) => ({
    ...chapter,
    site: siteNames.get(hostOf(chapter.url)) ?? chapter.site,
  }));

  const total = enrichment?.totalChapters;
  const totalChapters =
    total !== undefined && Number.isInteger(total) && total > 0 && total <= MAX_TOTAL_CHAPTERS
      ? total
      : undefined;
  const covered = new Set(
    [...hosted, ...seenExternal].filter((n) => n >= 1).map((n) => Math.floor(n)),
  );
  // Without a complete MangaDex archive we cannot tell what is missing, so no gap rows then.
  const archiveKnown =
    !reader || reader.status !== "available" || reader.archiveStatus === "complete";
  // A gap is only worth a row when there is an official place to read it in this language; the
  // total often counts original-language chapters a translation has not reached yet.
  const missingRanges =
    totalChapters && archiveKnown && readingLinks.length
      ? missingChapterRanges(covered, totalChapters)
      : [];

  if (!namedExternal.length && !missingRanges.length) return undefined;
  return {
    translatedLanguage,
    externalChapters: namedExternal,
    missingRanges,
    readingLinks,
    totalChapters,
  };
}

/** Whole-number chapters 1..total that are not covered, collapsed into inclusive ranges. */
export function missingChapterRanges(
  covered: ReadonlySet<number>,
  total: number,
): MangaChapterRange[] {
  const ranges: MangaChapterRange[] = [];
  let start: number | undefined;
  for (let chapter = 1; chapter <= total; chapter += 1) {
    if (!covered.has(chapter)) {
      start ??= chapter;
      continue;
    }
    if (start !== undefined) ranges.push({ from: start, to: chapter - 1 });
    start = undefined;
  }
  if (start !== undefined) ranges.push({ from: start, to: total });
  return ranges;
}

function matchesLanguage(linkLanguage: MangaReadingLink["language"], language: string): boolean {
  const link = linkLanguage.toLowerCase();
  return link === language || link.split("-")[0] === language.split("-")[0];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
