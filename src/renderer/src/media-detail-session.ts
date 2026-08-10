import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AniListListEntrySummary,
  AniStreamBridge,
  MalScore,
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaEnrichment,
  MangaReadingResume,
} from "../../shared/contracts";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";

export type MediaDetailSessionBridge = Pick<
  AniStreamBridge,
  | "getAniListMediaDetail"
  | "getMalScore"
  | "getMangaTitleSnapshot"
  | "cancelRequest"
  | "getMangaReadingResume"
>;

export interface MediaDetailSessionSnapshot {
  detail?: AniListMediaDetail;
  malScore?: MalScore;
  mangaEnrichment?: MangaEnrichment;
  readerSession?: MangaDexReaderSession;
  mangaResume?: MangaReadingResume;
  loading: boolean;
  loadingReader: boolean;
  savingTracker: boolean;
  error?: string;
}

export interface MediaDetailSession {
  getSnapshot(): MediaDetailSessionSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  openReader(): Promise<MangaDexReaderChapter | undefined>;
  refreshResume(): Promise<void>;
  addTitle(): Promise<AniListListEntrySummary>;
  saveRating(rating: number): Promise<void>;
  markEpisodeWatched(episode: number): Promise<void>;
  markMediaCompleted(): Promise<void>;
  markChapterRead(chapter: MangaDexReaderChapter): Promise<void>;
  dispose(): void;
}

export function createMediaDetailSession(options: {
  media: AniListCatalogMedia;
  access: ViewerAccess;
  bridge?: MediaDetailSessionBridge;
}): MediaDetailSession {
  const listeners = new Set<() => void>();
  let snapshot: MediaDetailSessionSnapshot = {
    loading: true,
    loadingReader: false,
    savingTracker: false,
  };
  let disposed = false;
  let generation = 0;
  let requestId: string | undefined;
  let lastMarkedEpisode: number | undefined;

  const getBridge = (): MediaDetailSessionBridge => {
    if (!options.bridge) throw new Error("Media detail bridge is unavailable.");
    return options.bridge;
  };

  const notify = (changes: Partial<MediaDetailSessionSnapshot>): void => {
    snapshot = { ...snapshot, ...changes };
    for (const listener of listeners) listener();
  };

  const ensureCurrent = (): void => {
    if (disposed) throw new Error("Media detail session is closed.");
  };

  const ensureListEntry = async (): Promise<AniListMediaDetail> => {
    ensureCurrent();
    if (!hasPersonalizedAccess(options.access)) {
      throw new Error("Connect AniList to manage this title in your list.");
    }
    const current =
      snapshot.detail ??
      (await getBridge().getAniListMediaDetail(options.media.id, options.media.type));
    if (current.listEntry) return current;
    const listEntry = await options.access.addToLibrary(current);
    const updated = { ...current, listEntry };
    notify({ detail: updated });
    return updated;
  };

  const runTrackerUpdate = async (
    operation: (current: AniListMediaDetail) => Promise<AniListListEntrySummary>,
    fallback: string,
  ): Promise<void> => {
    notify({ savingTracker: true, error: undefined });
    try {
      const current = await ensureListEntry();
      const listEntry = await operation(current);
      notify({
        detail: { ...current, listEntry },
        savingTracker: false,
        error: undefined,
      });
    } catch (reason) {
      notify({
        savingTracker: false,
        error: reason instanceof Error ? reason.message : fallback,
      });
      throw reason;
    }
  };

  const chooseChapterToRead = (
    reader: MangaDexReaderSession,
    progress: number,
    resume?: MangaReadingResume,
  ): MangaDexReaderChapter | undefined => {
    if (!reader.chapters.length) return undefined;
    if (resume) {
      const savedIndex = reader.chapters.findIndex((chapter) => chapter.id === resume.chapterId);
      if (savedIndex >= 0) {
        if (resume.progress >= 0.9 && savedIndex + 1 < reader.chapters.length) {
          return reader.chapters[savedIndex + 1];
        }
        return reader.chapters[savedIndex];
      }
    }
    if (progress > 0) {
      const nextChapter = reader.chapters.find(
        (chapter) =>
          chapter.number !== undefined && Math.floor(chapter.number) >= Math.floor(progress) + 1,
      );
      if (nextChapter) return nextChapter;
    }
    return reader.chapters[0];
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      ensureCurrent();
      const currentGeneration = ++generation;
      if (requestId) void getBridge().cancelRequest(requestId);
      const nextRequestId = `manga-title:${options.media.id}:${Date.now()}`;
      requestId = nextRequestId;
      notify({ loading: true, error: undefined });

      try {
        const detail = await getBridge().getAniListMediaDetail(
          options.media.id,
          options.media.type,
        );
        if (disposed || generation !== currentGeneration) return;
        notify({ detail, loading: false });

        const malPromise = detail.malId
          ? getBridge()
              .getMalScore(options.media.type, detail.malId)
              .catch(() => undefined)
          : Promise.resolve(undefined);
        const mangaPromise =
          options.media.type === "MANGA"
            ? getBridge()
                .getMangaTitleSnapshot(
                  { aniListId: options.media.id, title: options.media.title },
                  nextRequestId,
                )
                .catch((reason: unknown) => {
                  throw reason instanceof Error
                    ? reason
                    : new Error("Unable to load manga title data.");
                })
            : Promise.resolve(undefined);

        const [malScore, mangaSnapshot] = await Promise.all([malPromise, mangaPromise]);
        if (disposed || generation !== currentGeneration) return;
        notify({
          malScore,
          mangaEnrichment: mangaSnapshot?.enrichment,
          readerSession: mangaSnapshot?.reader,
          mangaResume: mangaSnapshot?.resume,
          error: mangaSnapshot?.issues.find((issue) => issue.source === "mangadex-reader")?.message,
        });
      } catch (reason) {
        if (!disposed && generation === currentGeneration) {
          notify({
            loading: false,
            error: reason instanceof Error ? reason.message : "Unable to load details.",
          });
        }
      } finally {
        if (requestId === nextRequestId) requestId = undefined;
      }
    },

    async openReader() {
      ensureCurrent();
      notify({ loadingReader: true, error: undefined });
      try {
        if (!snapshot.readerSession) {
          await this.load();
        }
        const reader = snapshot.readerSession;
        if (!reader) throw new Error("MangaDex reader is unavailable.");
        const savedResume =
          snapshot.mangaResume ?? (await getBridge().getMangaReadingResume(options.media.id));
        notify({ mangaResume: savedResume, loadingReader: false });
        return chooseChapterToRead(reader, snapshot.detail?.listEntry?.progress ?? 0, savedResume);
      } catch (reason) {
        notify({
          loadingReader: false,
          error: reason instanceof Error ? reason.message : "Unable to open MangaDex reader.",
        });
        return undefined;
      }
    },

    async refreshResume() {
      const resume = await getBridge().getMangaReadingResume(options.media.id);
      if (!disposed) notify({ mangaResume: resume });
    },

    async addTitle() {
      ensureCurrent();
      if (!hasPersonalizedAccess(options.access)) {
        throw new Error("Connect AniList to manage this title in your list.");
      }
      try {
        const listEntry = await options.access.addToLibrary(options.media);
        notify({ detail: snapshot.detail ? { ...snapshot.detail, listEntry } : snapshot.detail });
        return listEntry;
      } catch (reason) {
        notify({ error: reason instanceof Error ? reason.message : "Unable to add title." });
        throw reason;
      }
    },

    async saveRating(rating) {
      await runTrackerUpdate((current) => {
        if (!hasPersonalizedAccess(options.access) || !current.listEntry) {
          throw new Error("AniList entry was not created.");
        }
        return options.access.updateEntry({
          id: current.listEntry.id,
          score: Math.min(10, Math.max(0, rating)),
        });
      }, "Unable to save rating.");
    },

    async markEpisodeWatched(episode) {
      if (lastMarkedEpisode === episode) return;
      lastMarkedEpisode = episode;
      try {
        await runTrackerUpdate((current) => {
          if (!hasPersonalizedAccess(options.access) || !current.listEntry) {
            throw new Error("AniList did not return the new list entry.");
          }
          const progress = Math.max(current.listEntry.progress, episode);
          return options.access.updateEntry({
            id: current.listEntry.id,
            progress,
            status:
              current.totalProgress && progress >= current.totalProgress ? "COMPLETED" : "CURRENT",
          });
        }, "Unable to update AniList progress.");
      } catch {
        lastMarkedEpisode = undefined;
      }
    },

    async markMediaCompleted() {
      await runTrackerUpdate((current) => {
        if (!hasPersonalizedAccess(options.access) || !current.listEntry) {
          throw new Error("AniList entry was not created.");
        }
        return options.access.updateEntry({
          id: current.listEntry.id,
          status: "COMPLETED",
          progress: current.totalProgress ?? current.listEntry.progress,
        });
      }, "Unable to mark complete.");
    },

    async markChapterRead(chapter) {
      if (chapter.number === undefined) return;
      const chapterNumber = chapter.number;
      await runTrackerUpdate((current) => {
        if (!hasPersonalizedAccess(options.access) || !current.listEntry) {
          throw new Error("AniList entry was not created.");
        }
        const progress = Math.max(current.listEntry.progress, Math.floor(chapterNumber));
        return options.access.updateEntry({
          id: current.listEntry.id,
          progress,
          status:
            current.totalProgress && progress >= current.totalProgress ? "COMPLETED" : "CURRENT",
        });
      }, "Unable to update manga progress.");
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      if (requestId && options.bridge) void options.bridge.cancelRequest(requestId);
      requestId = undefined;
      listeners.clear();
    },
  };
}
