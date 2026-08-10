import type { SaveMangaReadingResumeInput } from "../../shared/contracts";

const RESUME_SAVE_INTERVAL_MS = 8_000;
const READ_COMPLETE_THRESHOLD = 0.9;
const PAGE_LOAD_CONCURRENCY = 3;

export interface MangaReaderPageResult {
  imageBytes: ArrayBuffer;
  mimeType: string;
}

export interface MangaReaderSessionSnapshot {
  pageUrls: Array<string | undefined>;
  pageErrors: Record<number, string>;
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
  getSnapshot(): MangaReaderSessionSnapshot;
  subscribe(listener: () => void): () => void;
  requestPage(page: number): void;
  markProgress(progress: number): void;
  dispose(): void;
}

export function createMangaReaderSession(options: MangaReaderSessionOptions): MangaReaderSession {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  const queuedPages: number[] = [];
  const requestedPages = new Set<number>();
  const activePageLoads = { count: 0 };
  const pageUrlsRef: Array<string | undefined> = Array.from({ length: options.pageCount });
  let snapshot: MangaReaderSessionSnapshot = {
    pageUrls: pageUrlsRef,
    pageErrors: {},
  };
  let readerActive = true;
  let lastSavedAt = 0;
  let latestProgress: number | undefined;
  let markedRead = false;

  const updateSnapshot = (next: MangaReaderSessionSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const persistProgress = (progress: number, force = false): void => {
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
    void Promise.resolve(options.saveResume(input)).catch(() => undefined);
  };

  const pump = (): void => {
    while (readerActive && activePageLoads.count < PAGE_LOAD_CONCURRENCY && queuedPages.length) {
      const page = queuedPages.shift();
      if (page === undefined) return;
      activePageLoads.count += 1;
      void options
        .loadPage(page)
        .then((result) => {
          if (!readerActive) return;
          const objectUrl = options.createObjectUrl(result);
          const nextPageUrls = [...snapshot.pageUrls];
          const previousUrl = nextPageUrls[page];
          if (previousUrl) options.revokeObjectUrl(previousUrl);
          nextPageUrls[page] = objectUrl;
          pageUrlsRef[page] = objectUrl;

          const nextErrors = { ...snapshot.pageErrors };
          delete nextErrors[page];
          updateSnapshot({ pageUrls: nextPageUrls, pageErrors: nextErrors });
        })
        .catch((reason: unknown) => {
          if (!readerActive) return;
          requestedPages.delete(page);
          updateSnapshot({
            pageUrls: snapshot.pageUrls,
            pageErrors: {
              ...snapshot.pageErrors,
              [page]: reason instanceof Error ? reason.message : `Unable to load page ${page + 1}.`,
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
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    requestPage(page) {
      if (
        !readerActive ||
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

    markProgress(progress) {
      persistProgress(progress);
      if (progress >= READ_COMPLETE_THRESHOLD && !markedRead) {
        markedRead = true;
        void Promise.resolve(options.onChapterRead()).catch(() => undefined);
      }
    },

    dispose() {
      if (!readerActive) return;
      readerActive = false;
      queuedPages.length = 0;
      requestedPages.clear();
      if (latestProgress !== undefined) persistProgress(latestProgress, true);
      for (const objectUrl of pageUrlsRef) {
        if (objectUrl) options.revokeObjectUrl(objectUrl);
      }
      listeners.clear();
    },
  };
}
