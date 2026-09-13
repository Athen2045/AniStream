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
    const [enrichmentResult, readerResult, resumeResult] = await Promise.allSettled([
      this.loadEnrichment(input.aniListId, issues, signal),
      this.loadReader(readerInput, signal),
      Promise.resolve(this.deps.resume?.getMangaReadingResume(input.aniListId)),
    ]);

    const enrichment = valueOrIssue(enrichmentResult, "mangabaka", issues);
    const reader = valueOrIssue(readerResult, "mangadex-reader", issues);
    const resume = valueOrIssue(resumeResult, "resume", issues);
    return { aniListId: input.aniListId, enrichment, reader, resume, preferences, issues };
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
