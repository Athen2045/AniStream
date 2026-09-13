import type { SaveMangaReadingResumeInput } from "../../shared/contracts";
import { friendlyRemoteError } from "./remote-error";

const RESUME_SAVE_INTERVAL_MS = 8_000;
const READ_COMPLETE_THRESHOLD = 0.9;
const PAGE_LOAD_CONCURRENCY = 3;
const RETAINED_PAGE_BYTES = 32 * 1024 * 1024;
const RETAINED_PAGE_COUNT = 12;

export interface MangaReaderPageResult {
  imageBytes: ArrayBuffer;
  mimeType: string;
}

export interface MangaReaderSessionSnapshot {
  pageUrls: Array<string | undefined>;
  pageErrors: Record<number, string>;
  persistenceError?: string;
}

export interface MangaReaderSessionOptions {
  aniListId: number;
  chapterId: string;
  chapterNumber?: number;
  pageCount: number;
  loadPage: (page: number) => Promise<MangaReaderPageResult>;
  createObjectUrl: (page: MangaReaderPageResult) => string;
  revokeObjectUrl: (url: string) => void;
  saveResume: (input: SaveMangaReadingResumeInput) => Promise<void> | void;
  onChapterRead: () => Promise<void> | void;
  now?: () => number;
}

export interface MangaReaderSession {
  activate(): void;
  getSnapshot(): MangaReaderSessionSnapshot;
  subscribe(listener: () => void): () => void;
  requestPage(page: number): void;
  markPageDecodeError(page: number, url: string): void;
  setPageNear(page: number, near: boolean): void;
  markProgress(progress: number): void;
  retryPersistence(): void;
  dispose(): void;
}

export function createMangaReaderSession(options: MangaReaderSessionOptions): MangaReaderSession {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const queuedPages: number[] = [];
  const requestedPages = new Set<number>();
  const nearPages = new Set<number>();
  const retainedPages = new Map<number, number>();
  let tracksViewport = false;
  const activePageLoads = { count: 0 };
  const pageUrlsRef: Array<string | undefined> = Array.from({ length: options.pageCount });
  let snapshot: MangaReaderSessionSnapshot = {
    pageUrls: pageUrlsRef,
    pageErrors: {},
  };
  let readerActive = true;
  let generation = 0;
  let lastSavedAt = 0;
  let latestProgress: number | undefined;
  let markedRead = false;
  let markingRead = false;
  let completionRequested = false;

  const updateSnapshot = (next: MangaReaderSessionSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const trim = (): void => {
    let bytes = [...retainedPages.values()].reduce((sum, size) => sum + size, 0);
    const urls = [...snapshot.pageUrls];
    let changed = false;
    for (const [page, size] of retainedPages) {
      if (bytes <= RETAINED_PAGE_BYTES && retainedPages.size <= RETAINED_PAGE_COUNT) break;
      if (nearPages.has(page)) continue;
      const url = urls[page];
      if (url) options.revokeObjectUrl(url);
      urls[page] = undefined;
      pageUrlsRef[page] = undefined;
      requestedPages.delete(page);
      retainedPages.delete(page);
      bytes -= size;
      changed = true;
    }
    if (changed) updateSnapshot({ ...snapshot, pageUrls: urls });
  };

  const persistProgress = (progress: number, force = false): void => {
    if (completionRequested) return;
    const normalized = Math.min(1, Math.max(0, progress));
    latestProgress = normalized;
    const timestamp = now();
    if (!force && timestamp - lastSavedAt < RESUME_SAVE_INTERVAL_MS) return;
    lastSavedAt = timestamp;
    const input: SaveMangaReadingResumeInput = {
      aniListId: options.aniListId,
      chapterId: options.chapterId,
      chapterNumber: options.chapterNumber,
      progress: normalized,
    };
    try {
      void Promise.resolve(options.saveResume(input)).then(
        () => {
          if (!completionRequested) updateSnapshot({ ...snapshot, persistenceError: undefined });
        },
        (reason: unknown) => {
          if (!markedRead)
            updateSnapshot({
              ...snapshot,
              persistenceError:
                reason instanceof Error ? reason.message : "Unable to save reading progress.",
            });
        },
      );
    } catch (reason) {
      updateSnapshot({
        ...snapshot,
        persistenceError:
          reason instanceof Error ? reason.message : "Unable to save reading progress.",
      });
    }
  };

  const complete = (): void => {
    if (markedRead || markingRead) return;
    markingRead = true;
    completionRequested = true;
    void (async () => {
      try {
        await options.onChapterRead();
        markedRead = true;
        updateSnapshot({ ...snapshot, persistenceError: undefined });
      } catch (reason) {
        updateSnapshot({
          ...snapshot,
          persistenceError:
            reason instanceof Error ? reason.message : "Unable to save chapter completion.",
        });
      } finally {
        markingRead = false;
      }
    })();
  };

  const pump = (): void => {
    while (readerActive && activePageLoads.count < PAGE_LOAD_CONCURRENCY && queuedPages.length) {
      const page = queuedPages.shift();
      if (page === undefined) return;
      activePageLoads.count += 1;
      const current = generation;
      void Promise.resolve()
        .then(() => (readerActive && current === generation ? options.loadPage(page) : undefined))
        .then((result) => {
          if (!result || !readerActive || current !== generation) return;
          if (tracksViewport && !nearPages.has(page)) {
            requestedPages.delete(page);
            return;
          }
          const objectUrl = options.createObjectUrl(result);
          const nextPageUrls = [...snapshot.pageUrls];
          const previousUrl = nextPageUrls[page];
          if (previousUrl) options.revokeObjectUrl(previousUrl);
          nextPageUrls[page] = objectUrl;
          pageUrlsRef[page] = objectUrl;
          retainedPages.delete(page);
          retainedPages.set(page, result.imageBytes.byteLength);

          const nextErrors = { ...snapshot.pageErrors };
          delete nextErrors[page];
          updateSnapshot({ ...snapshot, pageUrls: nextPageUrls, pageErrors: nextErrors });
          trim();
        })
        .catch((reason: unknown) => {
          if (!readerActive || current !== generation) return;
          requestedPages.delete(page);
          updateSnapshot({
            ...snapshot,
            pageUrls: snapshot.pageUrls,
            pageErrors: {
              ...snapshot.pageErrors,
              [page]: friendlyRemoteError(reason, {
                provider: "MangaDex",
                operation: "manga pages",
                fallback: `Page ${page + 1} could not be loaded. Try again.`,
              }),
            },
          });
        })
        .finally(() => {
          activePageLoads.count -= 1;
          pump();
        });
    }
  };

  return {
    activate() {
      readerActive = true;
    },
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    requestPage(page) {
      if (
        !readerActive ||
        !Number.isInteger(page) ||
        page < 0 ||
        page >= options.pageCount ||
        snapshot.pageUrls[page] ||
        requestedPages.has(page)
      ) {
        return;
      }
      requestedPages.add(page);
      queuedPages.push(page);
      pump();
    },

    setPageNear(page, near) {
      if (!readerActive || !Number.isInteger(page) || page < 0 || page >= options.pageCount) return;
      tracksViewport = true;
      if (near) {
        nearPages.add(page);
        const size = retainedPages.get(page);
        if (size !== undefined) {
          retainedPages.delete(page);
          retainedPages.set(page, size);
        }
      } else {
        nearPages.delete(page);
        const queued = queuedPages.indexOf(page);
        if (queued >= 0) {
          queuedPages.splice(queued, 1);
          requestedPages.delete(page);
        }
      }
      trim();
    },

    markPageDecodeError(page, url) {
      if (!readerActive || snapshot.pageUrls[page] !== url) return;
      options.revokeObjectUrl(url);
      pageUrlsRef[page] = undefined;
      retainedPages.delete(page);
      requestedPages.delete(page);
      const pageUrls = [...snapshot.pageUrls];
      pageUrls[page] = undefined;
      updateSnapshot({
        ...snapshot,
        pageUrls,
        pageErrors: {
          ...snapshot.pageErrors,
          [page]: "This image could not be displayed. Try loading it again.",
        },
      });
    },

    markProgress(progress) {
      if (!readerActive || !Number.isFinite(progress)) return;
      persistProgress(progress);
      if (progress >= READ_COMPLETE_THRESHOLD) complete();
    },

    retryPersistence() {
      if (completionRequested) complete();
      else if (latestProgress !== undefined) persistProgress(latestProgress, true);
    },

    dispose() {
      if (!readerActive) return;
      readerActive = false;
      generation++;
      queuedPages.length = 0;
      requestedPages.clear();
      nearPages.clear();
      retainedPages.clear();
      if (latestProgress !== undefined) persistProgress(latestProgress, true);
      for (const objectUrl of pageUrlsRef) {
        if (objectUrl) options.revokeObjectUrl(objectUrl);
      }
      pageUrlsRef.fill(undefined);
      snapshot = { ...snapshot, pageUrls: [...pageUrlsRef], pageErrors: {} };
      listeners.clear();
    },
  };
}
