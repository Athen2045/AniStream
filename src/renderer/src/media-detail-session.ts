import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AniListListEntrySummary,
  AniStreamBridge,
  MalScore,
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaEnrichment,
  MangaReaderPreferences,
  MangaReadingResume,
  MangaTitleSnapshot,
  SaveMangaReaderPreferencesInput,
} from "../../shared/contracts";
import { selectChapterToRead } from "../../shared/chapter-selection";
import { friendlyRemoteError } from "./remote-error";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";

function displayLanguage(language: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(language) ?? language.toUpperCase()
    );
  } catch {
    return language.toUpperCase();
  }
}

function readerUnavailableMessage(reader?: MangaDexReaderSession): string {
  if (reader?.status === "unmapped")
    return "This title is not linked to MangaDex yet, so AniStream cannot open its chapters.";
  if (reader?.status === "available" && reader.chapters.length === 0) {
    const language = displayLanguage(reader.translatedLanguage);
    return `No readable chapters are available in ${language} yet. Try another language if one is listed.`;
  }
  return friendlyRemoteError(reader?.message, {
    provider: "MangaDex",
    operation: "chapters",
    fallback: "MangaDex could not open chapters for this title. Try again shortly.",
  });
}

export type MediaDetailSessionBridge = Pick<
  AniStreamBridge,
  | "getAniListMediaDetail"
  | "getMalScore"
  | "getMangaTitleSnapshot"
  | "cancelRequest"
  | "getMangaReadingResume"
  | "saveMangaReaderPreferences"
  | "recordActivity"
>;

export interface MediaDetailSessionSnapshot {
  detail?: AniListMediaDetail;
  malScore?: MalScore;
  mangaEnrichment?: MangaEnrichment;
  readerSession?: MangaDexReaderSession;
  mangaResume?: MangaReadingResume;
  mangaPreferences?: MangaReaderPreferences;
  loading: boolean;
  loadingReader: boolean;
  savingTracker: boolean;
  error?: string;
}

export interface MediaDetailSession {
  activate(): void;
  getSnapshot(): MediaDetailSessionSnapshot;
  subscribe(listener: () => void): () => void;
  updateAccess(access: ViewerAccess): void;
  load(): Promise<void>;
  openReader(): Promise<MangaDexReaderChapter | undefined>;
  retryReader(): Promise<void>;
  setMangaReaderPreferences(input: SaveMangaReaderPreferencesInput): Promise<void>;
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
  let readerGeneration = 0;
  let loadInFlight: Promise<void> | undefined;
  let detailReady: Promise<AniListMediaDetail | undefined> | undefined;
  let readerReady: Promise<void> | undefined;
  let preferencesInFlight: Promise<void> | undefined;
  let requestId: string | undefined;
  let lastMarkedEpisode: number | undefined;

  const applyMangaSnapshot = (
    mangaSnapshot: MangaTitleSnapshot,
    clearResolvedReaderError = false,
  ): void => {
    const issue = mangaSnapshot.issues.find((item) => item.source === "mangadex-reader");
    const error = issue
      ? friendlyRemoteError(issue.message, {
          provider: "MangaDex",
          operation: "chapters",
          fallback: readerUnavailableMessage(mangaSnapshot.reader),
        })
      : undefined;
    notify({
      mangaEnrichment: mangaSnapshot.enrichment,
      readerSession: mangaSnapshot.reader,
      mangaResume: mangaSnapshot.resume,
      mangaPreferences: mangaSnapshot.preferences,
      ...(error
        ? { error }
        : clearResolvedReaderError && snapshot.detail
          ? { error: undefined }
          : {}),
    });
  };

  const recordCompletion = async (unit: number, chapterId?: string): Promise<void> => {
    try {
      const activity = await getBridge().recordActivity({
        media: snapshot.detail ?? options.media,
        unit,
        chapterId,
        state: "completed",
      });
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("anistream:activity-updated"));
      notify({
        error:
          activity.syncStatus === "pending" && activity.syncError
            ? "Saved locally. AniList sync is pending; retry from Continue."
            : undefined,
      });
      if (activity.syncStatus === "synced" && hasPersonalizedAccess(options.access)) {
        void options.access.refreshLibrary().catch(() => undefined);
      }
    } catch (reason) {
      notify({
        error: reason instanceof Error ? reason.message : "Unable to save local completion.",
      });
      throw reason;
    }
  };

  const getBridge = (): MediaDetailSessionBridge => {
    if (!options.bridge) throw new Error("Media detail bridge is unavailable.");
    return options.bridge;
  };

  const notify = (changes: Partial<MediaDetailSessionSnapshot>): void => {
    if (disposed) return;
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
        error: friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "library changes",
          fallback,
        }),
      });
      throw reason;
    }
  };

  return {
    activate() {
      disposed = false;
    },
    getSnapshot: () => snapshot,
    updateAccess(access) {
      options.access = access;
      if (snapshot.detail) {
        const listEntry =
          access.kind === "member" ? access.libraryEntries.get(options.media.id) : undefined;
        if (snapshot.detail.listEntry !== listEntry)
          notify({ detail: { ...snapshot.detail, listEntry } });
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      ensureCurrent();
      if (loadInFlight) return loadInFlight;
      const currentGeneration = ++generation;
      const currentReaderGeneration = ++readerGeneration;
      if (requestId) void getBridge().cancelRequest(requestId);
      const nextRequestId = `manga-title:${options.media.id}:${Date.now()}:${currentReaderGeneration}`;
      requestId = nextRequestId;
      notify({
        loading: true,
        loadingReader: options.media.type === "MANGA",
        error: undefined,
      });
      const isCurrent = () => !disposed && generation === currentGeneration;
      detailReady = (async () => {
        try {
          const detail = await getBridge().getAniListMediaDetail(
            options.media.id,
            options.media.type,
          );
          if (!isCurrent()) return undefined;
          notify({ detail, loading: false });
          return detail;
        } catch (reason) {
          if (isCurrent())
            notify({
              loading: false,
              error: friendlyRemoteError(reason, {
                provider: "AniList",
                operation: "title details",
                fallback: "Title details could not be loaded. Try again shortly.",
              }),
            });
          return undefined;
        }
      })();

      // Exact AniList identity is already known. Chapter delivery does not depend on
      // detail metadata, and neither path should wait for the optional MAL score.
      readerReady = (async () => {
        try {
          if (options.media.type !== "MANGA") return;
          const mangaSnapshot = await getBridge().getMangaTitleSnapshot(
            { aniListId: options.media.id, title: options.media.title },
            nextRequestId,
          );
          if (!isCurrent() || readerGeneration !== currentReaderGeneration) return;
          applyMangaSnapshot(mangaSnapshot);
        } catch (reason) {
          if (isCurrent() && readerGeneration === currentReaderGeneration)
            notify({
              error: friendlyRemoteError(reason, {
                provider: "MangaDex",
                operation: "chapters",
                fallback: "MangaDex chapters could not be loaded. Try again shortly.",
              }),
            });
        } finally {
          if (isCurrent() && readerGeneration === currentReaderGeneration)
            notify({ loadingReader: false });
          if (requestId === nextRequestId) requestId = undefined;
        }
      })();
      const scoreReady = detailReady.then(async (detail) => {
        if (!detail?.malId || !isCurrent()) return;
        let malScore: MalScore | undefined;
        try {
          malScore = await getBridge().getMalScore(options.media.type, detail.malId);
        } catch {
          // Optional cross-reference must never turn a usable title into a failed load.
        }
        if (isCurrent()) notify({ malScore });
      });
      const completion = Promise.all([detailReady, readerReady, scoreReady]).then(() => undefined);
      loadInFlight = completion;
      try {
        await completion;
      } finally {
        if (loadInFlight === completion) loadInFlight = undefined;
      }
    },

    async openReader() {
      ensureCurrent();
      notify({ loadingReader: true, error: undefined });
      try {
        if (!snapshot.readerSession) {
          if (!loadInFlight && !preferencesInFlight) void this.load();
        }
        const currentGeneration = generation;
        const currentReaderGeneration = readerGeneration;
        await Promise.all([detailReady, preferencesInFlight ?? readerReady]);
        ensureCurrent();
        if (currentGeneration !== generation || currentReaderGeneration !== readerGeneration)
          return undefined;
        const reader = snapshot.readerSession;
        if (!reader) throw new Error("MangaDex reader is unavailable.");
        if (reader.status !== "available" || reader.chapters.length === 0) {
          notify({ loadingReader: false, error: readerUnavailableMessage(reader) });
          return undefined;
        }
        const savedResume =
          snapshot.mangaResume ?? (await getBridge().getMangaReadingResume(options.media.id));
        if (
          disposed ||
          currentGeneration !== generation ||
          currentReaderGeneration !== readerGeneration
        )
          return undefined;
        const selected = selectChapterToRead(
          reader.chapters,
          snapshot.detail?.listEntry?.progress ?? 0,
          savedResume,
          reader.preferredGroupId,
        );
        notify({
          mangaResume: savedResume,
          loadingReader: false,
          error: selected ? undefined : readerUnavailableMessage(reader),
        });
        return selected;
      } catch (reason) {
        notify({
          loadingReader: false,
          error: friendlyRemoteError(reason, {
            provider: "MangaDex",
            operation: "chapters",
            fallback: "The manga reader could not be opened. Try loading the chapters again.",
          }),
        });
        return undefined;
      }
    },

    async retryReader() {
      ensureCurrent();
      if (options.media.type !== "MANGA") return;
      const currentGeneration = generation;
      const currentReaderGeneration = ++readerGeneration;
      if (requestId) void getBridge().cancelRequest(requestId);
      const nextRequestId = `manga-title:${options.media.id}:${Date.now()}:${currentReaderGeneration}:retry`;
      requestId = nextRequestId;
      notify({ loadingReader: true, error: undefined });
      const retry = (async () => {
        try {
          const mangaSnapshot = await getBridge().getMangaTitleSnapshot(
            { aniListId: options.media.id, title: options.media.title },
            nextRequestId,
          );
          if (
            disposed ||
            generation !== currentGeneration ||
            readerGeneration !== currentReaderGeneration
          )
            return;
          applyMangaSnapshot(mangaSnapshot, true);
        } catch (reason) {
          if (
            !disposed &&
            generation === currentGeneration &&
            readerGeneration === currentReaderGeneration
          )
            notify({
              error: friendlyRemoteError(reason, {
                provider: "MangaDex",
                operation: "chapters",
                fallback: "MangaDex chapters could not be loaded. Try again shortly.",
              }),
            });
        } finally {
          if (
            !disposed &&
            generation === currentGeneration &&
            readerGeneration === currentReaderGeneration
          )
            notify({ loadingReader: false });
          if (requestId === nextRequestId) requestId = undefined;
        }
      })();
      readerReady = retry;
      await retry;
    },

    async setMangaReaderPreferences(input) {
      ensureCurrent();
      const currentGeneration = ++readerGeneration;
      if (requestId) void getBridge().cancelRequest(requestId);
      const nextRequestId = `manga-title:${options.media.id}:${Date.now()}:${currentGeneration}:preferences`;
      requestId = nextRequestId;
      notify({ loadingReader: true, error: undefined });
      const change = (async () => {
        try {
          const saved = await getBridge().saveMangaReaderPreferences(input);
          if (disposed || readerGeneration !== currentGeneration) return;
          const mangaSnapshot = await getBridge().getMangaTitleSnapshot(
            { aniListId: options.media.id, title: options.media.title },
            nextRequestId,
          );
          if (disposed || readerGeneration !== currentGeneration) return;
          applyMangaSnapshot(
            {
              ...mangaSnapshot,
              preferences: mangaSnapshot.preferences ?? saved,
            },
            true,
          );
          notify({ loadingReader: false });
        } catch (reason) {
          if (!disposed && readerGeneration === currentGeneration) {
            notify({
              loadingReader: false,
              error: friendlyRemoteError(reason, {
                provider: "MangaDex",
                operation: "chapters",
                fallback:
                  "Reader settings could not be applied. Your previous settings are unchanged.",
              }),
            });
          }
          throw reason;
        } finally {
          if (requestId === nextRequestId) requestId = undefined;
        }
      })();
      preferencesInFlight = change;
      try {
        await change;
      } finally {
        if (preferencesInFlight === change) preferencesInFlight = undefined;
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
        notify({
          error: friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "library changes",
            fallback: "This title could not be added to your AniList library. Try again.",
          }),
        });
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
      await recordCompletion(episode);
      lastMarkedEpisode = episode;
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
      await recordCompletion(chapter.number ?? 0, chapter.id);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      readerGeneration += 1;
      loadInFlight = undefined;
      detailReady = undefined;
      readerReady = undefined;
      preferencesInFlight = undefined;
      if (requestId && options.bridge) void options.bridge.cancelRequest(requestId);
      requestId = undefined;
      listeners.clear();
    },
  };
}
