import type {
  MangaDexReaderInput,
  MangaDexReaderSession,
  MangaEnrichment,
  MangaReadingResume,
  MangaReaderPreferences,
  MangaTitleIssue,
  MangaTitleSnapshot,
  MangaUpdatesEnrichment,
  MangaUpdatesGroup,
} from "../shared/contracts";
import { buildMangaChapterFallback } from "./manga-chapter-fallback";
import { mergeMirrorChapters, MIRROR_LANGUAGE, type MirrorChapter } from "./manga-mirror";

export interface MangaTitleModuleDeps {
  mangaBaka?: {
    getEnrichment(aniListId: number, signal?: AbortSignal): Promise<MangaEnrichment>;
  };
  mangaUpdates?: {
    getSeries(seriesId: number, signal?: AbortSignal): Promise<MangaUpdatesEnrichment>;
    getGroups(seriesId: number, signal?: AbortSignal): Promise<MangaUpdatesGroup[]>;
  };
  mangaDex?: {
    getReader(input: MangaDexReaderInput, signal?: AbortSignal): Promise<MangaDexReaderSession>;
  };
  resume?: {
    getMangaReadingResume(aniListId: number): MangaReadingResume | undefined;
  };
  preferences?: {
    getMangaReaderPreferences(aniListId: number): MangaReaderPreferences | undefined;
  };
  /** Adds official-site chapters MangaDex cannot serve in-app (manga `official-links` media). */
  chapterFallback?: boolean;
  /** Configured chapter mirror (manga `chapter-mirror` media): fills English chapters MangaDex lacks. */
  mirror?: {
    label: string;
    getChapters(aniListId: number, signal?: AbortSignal): Promise<MirrorChapter[]>;
  };
}

/**
 * Owns the provider order and degraded-mode policy for a manga detail view.
 * The renderer learns one interface; MangaDex page bytes intentionally remain separate.
 */
export class MangaTitleModule {
  public constructor(private readonly deps: MangaTitleModuleDeps) {}

  public async load(input: MangaDexReaderInput, signal?: AbortSignal): Promise<MangaTitleSnapshot> {
    const issues: MangaTitleIssue[] = [];
    const preferences = this.deps.preferences?.getMangaReaderPreferences(input.aniListId);
    const readerInput = preferences
      ? {
          ...input,
          translatedLanguage: preferences.translatedLanguage,
          preferredGroupId: preferences.preferredGroupId,
        }
      : input;
    const mirror = this.deps.mirror;
    // The mirror is English-only; skip it outright for an explicit other-language request.
    const wantsMirror =
      mirror && (readerInput.translatedLanguage ?? MIRROR_LANGUAGE) === MIRROR_LANGUAGE;
    const [enrichmentResult, readerResult, resumeResult, mirrorResult] = await Promise.allSettled([
      this.loadEnrichment(input.aniListId, issues, signal),
      this.loadReader(readerInput, signal),
      Promise.resolve(this.deps.resume?.getMangaReadingResume(input.aniListId)),
      wantsMirror ? mirror.getChapters(input.aniListId, signal) : Promise.resolve([]),
    ]);

    const enrichment = valueOrIssue(enrichmentResult, "mangabaka", issues);
    const mangaDexReader = valueOrIssue(readerResult, "mangadex-reader", issues);
    // A mirror failure only means "no extra chapters"; MangaDex is never affected.
    const mirrorChapters = valueOrIssue(mirrorResult, "chapter-mirror", issues) ?? [];
    const reader =
      mirror && mirrorChapters.length
        ? mergeMirrorChapters({
            aniListId: input.aniListId,
            reader: mangaDexReader,
            mirror: mirrorChapters,
            label: mirror.label,
          })
        : mangaDexReader;
    const resume = valueOrIssue(resumeResult, "resume", issues);
    const chapterFallback = this.deps.chapterFallback
      ? buildMangaChapterFallback({
          reader,
          enrichment,
          defaultLanguage: readerInput.translatedLanguage ?? "en",
        })
      : undefined;
    return {
      aniListId: input.aniListId,
      enrichment,
      reader,
      resume,
      preferences,
      ...(chapterFallback ? { chapterFallback } : {}),
      issues,
    };
  }

  private async loadEnrichment(
    aniListId: number,
    issues: MangaTitleIssue[],
    signal?: AbortSignal,
  ): Promise<MangaEnrichment | undefined> {
    if (!this.deps.mangaBaka) return undefined;
    const enrichment = await this.deps.mangaBaka.getEnrichment(aniListId, signal);
    if (
      enrichment.status !== "available" ||
      !enrichment.mangaUpdatesId ||
      !this.deps.mangaUpdates
    ) {
      return enrichment;
    }

    const seriesId = Number(enrichment.mangaUpdatesId);
    if (!Number.isInteger(seriesId) || seriesId <= 0) return enrichment;
    const [seriesResult, groupsResult] = await Promise.allSettled([
      this.deps.mangaUpdates.getSeries(seriesId, signal),
      this.deps.mangaUpdates.getGroups(seriesId, signal),
    ]);
    if (seriesResult.status === "rejected") {
      issues.push(issue("mangaupdates-series", seriesResult.reason));
      if (groupsResult.status === "rejected") {
        issues.push(issue("mangaupdates-groups", groupsResult.reason));
      }
      return enrichment;
    }
    const groups =
      groupsResult.status === "fulfilled"
        ? groupsResult.value
        : (issues.push(issue("mangaupdates-groups", groupsResult.reason)), []);
    return { ...enrichment, mangaUpdates: { ...seriesResult.value, groups } };
  }

  private async loadReader(
    input: MangaDexReaderInput,
    signal?: AbortSignal,
  ): Promise<MangaDexReaderSession | undefined> {
    return this.deps.mangaDex?.getReader(input, signal);
  }
}

function valueOrIssue<T>(
  result: PromiseSettledResult<T>,
  source: MangaTitleIssue["source"],
  issues: MangaTitleIssue[],
): T | undefined {
  if (result.status === "fulfilled") return result.value;
  issues.push(issue(source, result.reason));
  return undefined;
}

function issue(source: MangaTitleIssue["source"], reason: unknown): MangaTitleIssue {
  return {
    source,
    message: reason instanceof Error ? reason.message : "Provider request failed.",
  };
}
