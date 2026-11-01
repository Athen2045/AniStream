import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaReadingResume,
} from "../../shared/contracts";
import { selectChapterToRead } from "../../shared/chapter-selection";
import { chapterDownloadKey, type MangaChapterDownload } from "../../shared/downloads";
import { useOptionalDownloads } from "./DownloadsProvider";
import type { MediaDetailSession } from "./media-detail-session";
import { friendlyRemoteError } from "./remote-error";

/**
 * The title page's manga reader: the chapter list to show (live, or the downloaded chapters when
 * offline), the chapter open in the reader, and opening a chapter from whichever copy can serve it.
 */
export function useTitleReader({
  aniListId,
  online,
  session,
  loadedSession,
  progress,
  resume,
}: {
  aniListId: number;
  online: boolean;
  session: MediaDetailSession;
  /** The live chapter list from the title page's session. */
  loadedSession: MangaDexReaderSession | undefined;
  /** Chapters read according to the list entry. */
  progress: number;
  resume: MangaReadingResume | undefined;
}) {
  // MangaDex chapters found unreadable this session, mapped to the mirror copy that replaced them.
  const [swappedChapters, setSwappedChapters] = useState<
    ReadonlyMap<string, MangaDexReaderChapter>
  >(() => new Map());
  const downloads = useOptionalDownloads();
  // Offline, a manga with downloaded chapters lists just those, read from disk (like Anime's
  // downloaded episodes). Built from the downloads, so it needs no saved chapter list.
  const offlineSession = useMemo(
    () => (online ? undefined : downloadedChapterSession(aniListId, downloads?.state?.chapters)),
    [downloads?.state?.chapters, aniListId, online],
  );
  const readerSession = useMemo(
    () =>
      offlineSession ??
      (loadedSession && swappedChapters.size
        ? {
            ...loadedSession,
            chapters: loadedSession.chapters.map(
              (chapter) => swappedChapters.get(chapter.id) ?? chapter,
            ),
          }
        : loadedSession),
    [loadedSession, offlineSession, swappedChapters],
  );
  const [activeChapter, setActiveChapter] = useState<MangaDexReaderChapter>();
  const [chapterOpenError, setChapterOpenError] = useState<string>();
  const chapterOpenGeneration = useRef(0);
  const downloadsRef = useRef(downloads);
  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);
  /**
   * Opens a chapter in the reader. Mirror chapters list no page count until opened, so it is
   * resolved first. A MangaDex chapter with a mirror copy is checked first and swapped for the
   * mirror copy when MangaDex cannot serve its images.
   */
  const openChapter = useCallback((chapter: MangaDexReaderChapter | undefined): void => {
    const generation = ++chapterOpenGeneration.current;
    const current = (): boolean => generation === chapterOpenGeneration.current;
    setChapterOpenError(undefined);
    if (!chapter) return;
    // Downloaded: opens straight from disk, with no source checks (works offline).
    const saved = downloadsRef.current?.byChapter.get(
      chapterDownloadKey(chapter.source === "mirror" ? "mirror" : "mangadex", chapter.id),
    );
    if (saved?.status === "done") {
      setActiveChapter({ ...chapter, pages: saved.pagesTotal });
      return;
    }
    const openMirror = (mirror: MangaDexReaderChapter): void => {
      void window.anistream.getMangaMirrorChapter({ chapterId: mirror.id }).then(
        (info) => {
          if (current()) setActiveChapter({ ...mirror, pages: info.pageCount });
        },
        (error: unknown) => {
          if (!current()) return;
          setChapterOpenError(
            friendlyRemoteError(error, {
              provider: mirror.sourceLabel ?? "The chapter mirror",
              operation: "chapters",
              fallback: `Chapter ${mirror.number ?? ""} could not be opened. Try again shortly.`,
            }),
          );
        },
      );
    };
    if (chapter.source === "mirror") {
      if (chapter.pages > 0) setActiveChapter(chapter);
      else openMirror(chapter);
      return;
    }
    const fallback = chapter.mirrorFallback;
    if (!fallback) {
      setActiveChapter(chapter);
      return;
    }
    void window.anistream.isMangaDexChapterReadable({ chapterId: chapter.id }).then(
      (readable) => {
        if (!current()) return;
        if (readable) {
          setActiveChapter(chapter);
          return;
        }
        const mirror: MangaDexReaderChapter = {
          ...chapter,
          id: fallback.id,
          title: undefined,
          groups: [],
          groupName: undefined,
          pages: 0,
          source: "mirror",
          sourceLabel: fallback.sourceLabel,
          mirrorFallback: undefined,
        };
        // Keep the swap in the chapter list so reader navigation and the list both use the copy.
        setSwappedChapters((previous) => new Map(previous).set(chapter.id, mirror));
        openMirror(mirror);
      },
      // The check itself failed; let the normal MangaDex path show its own error.
      () => {
        if (current()) setActiveChapter(chapter);
      },
    );
  }, []);

  /** Read: the chapter to continue from (offline, picked among the downloaded chapters). */
  const openPreferredChapter = useCallback(async (): Promise<void> => {
    if (offlineSession) {
      openChapter(selectChapterToRead(offlineSession.chapters, progress, resume));
      return;
    }
    openChapter(await session.openReader());
  }, [offlineSession, openChapter, progress, resume, session]);

  const closeChapter = useCallback((): void => setActiveChapter(undefined), []);

  return {
    readerSession,
    /** Offline with downloaded chapters: the list holds only those. */
    downloadedOnly: offlineSession !== undefined,
    activeChapter,
    chapterOpenError,
    openChapter,
    openPreferredChapter,
    closeChapter,
  };
}

/** The downloaded chapters of one title as a reader session, for reading offline. */
export function downloadedChapterSession(
  aniListId: number,
  items: readonly MangaChapterDownload[] | undefined,
): MangaDexReaderSession | undefined {
  const done = (items ?? []).filter(
    (item) => item.aniListId === aniListId && item.status === "done",
  );
  if (!done.length) return undefined;
  const chapters = done
    .map(({ chapter, pagesTotal }): MangaDexReaderChapter => ({
      id: chapter.id,
      ...(chapter.number !== undefined ? { number: chapter.number } : {}),
      ...(chapter.volume ? { volume: chapter.volume } : {}),
      ...(chapter.chapterTitle ? { title: chapter.chapterTitle } : {}),
      translatedLanguage: chapter.translatedLanguage,
      groups: chapter.groups,
      ...(chapter.groups.length
        ? { groupName: chapter.groups.map((group) => group.name).join(", ") }
        : {}),
      pages: pagesTotal,
      ...(chapter.source === "mirror"
        ? {
            source: "mirror" as const,
            ...(chapter.sourceLabel ? { sourceLabel: chapter.sourceLabel } : {}),
          }
        : {}),
    }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const languages = [...new Set(chapters.map((chapter) => chapter.translatedLanguage))];
  return {
    status: "available",
    aniListId,
    translatedLanguage: languages[0] ?? "en",
    availableLanguages: languages,
    availableGroups: [],
    archiveStatus: "complete",
    chapters,
  };
}
