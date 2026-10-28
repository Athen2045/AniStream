import { useCallback, useMemo, useState } from "react";
import type {
  AniListCatalogMedia,
  MangaDexReaderChapter,
  MangaDexReaderSession,
} from "../../shared/contracts";
import type { MangaChapterDownload } from "../../shared/downloads";
import { useDownloads } from "./DownloadsProvider";
import { MangaReaderFullscreen } from "./MangaReaderFullscreen";

/** A downloaded chapter as the reader's chapter shape. */
export function downloadedReaderChapter(item: MangaChapterDownload): MangaDexReaderChapter {
  const { chapter } = item;
  return {
    id: chapter.id,
    ...(chapter.number !== undefined ? { number: chapter.number } : {}),
    ...(chapter.volume ? { volume: chapter.volume } : {}),
    ...(chapter.chapterTitle ? { title: chapter.chapterTitle } : {}),
    translatedLanguage: chapter.translatedLanguage,
    groups: chapter.groups,
    pages: item.pagesTotal,
    ...(chapter.source === "mirror" ? { source: "mirror" as const } : {}),
    ...(chapter.sourceLabel ? { sourceLabel: chapter.sourceLabel } : {}),
  };
}

/**
 * The reader opened from Downloads: only this title's downloaded chapters, read from disk, so it
 * works with no connection. Finished chapters are saved locally and sync to AniList later.
 */
export function DownloadedChapterReader({
  aniListId,
  chapterId,
  onClose,
}: {
  aniListId: number;
  chapterId: string;
  onClose: () => void;
}): React.JSX.Element | null {
  const { state } = useDownloads();
  const [currentId, setCurrentId] = useState(chapterId);
  const items = useMemo(
    () =>
      (state?.chapters ?? [])
        .filter((item) => item.aniListId === aniListId && item.status === "done")
        .sort((a, b) => (a.chapter.number ?? 0) - (b.chapter.number ?? 0)),
    [aniListId, state],
  );
  const first = items[0];
  const media = useMemo<AniListCatalogMedia | undefined>(
    () =>
      first
        ? {
            id: aniListId,
            type: "MANGA",
            title: first.title,
            coverUrl: first.coverUrl ?? "",
            genres: [],
            siteUrl: `https://anilist.co/manga/${aniListId}`,
          }
        : undefined,
    [aniListId, first],
  );
  const session = useMemo<MangaDexReaderSession>(
    () => ({
      status: "available",
      aniListId,
      translatedLanguage: first?.chapter.translatedLanguage ?? "en",
      availableLanguages: [],
      availableGroups: [],
      archiveStatus: "complete",
      chapters: items.map(downloadedReaderChapter),
    }),
    [aniListId, first, items],
  );
  const onChapterRead = useCallback(
    async (chapter: MangaDexReaderChapter): Promise<void> => {
      if (!media) return;
      await window.anistream.recordActivity({
        media,
        unit: chapter.number ?? 0,
        chapterId: chapter.id,
        state: "completed",
      });
      window.dispatchEvent(new Event("anistream:activity-updated"));
    },
    [media],
  );
  const chapter = session.chapters.find((item) => item.id === currentId);
  if (!media || !chapter) return null;
  return (
    <MangaReaderFullscreen
      media={media}
      aniListId={aniListId}
      title={media.title}
      session={session}
      chapter={chapter}
      onClose={onClose}
      onChapterChange={(next) => setCurrentId(next.id)}
      onChapterRead={onChapterRead}
    />
  );
}
