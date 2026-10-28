import { Check, CircleCheck, Clock3, Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildLogicalChapterSequence } from "../../shared/chapter-selection";
import type {
  AniListCatalogMedia,
  MangaDexReaderChapter,
  MangaDexReaderSession,
} from "../../shared/contracts";
import {
  CHAPTER_ESTIMATE_BYTES,
  MAX_CHAPTER_BATCH,
  chapterDownloadKey,
  formatBytes,
  type DownloadChapterRequest,
} from "../../shared/downloads";
import { ProgressRing } from "./DownloadButtons";
import { useOptionalDownloads } from "./DownloadsProvider";

/** How many chapters the dialog's smaller choice queues. */
const NEXT_BATCH = 10;

export function chapterRequest(
  media: AniListCatalogMedia,
  chapter: MangaDexReaderChapter,
): DownloadChapterRequest {
  return {
    aniListId: media.id,
    title: media.title,
    ...(/^https:\/\//.test(media.coverUrl) ? { coverUrl: media.coverUrl } : {}),
    chapter: {
      source: chapter.source === "mirror" ? "mirror" : "mangadex",
      id: chapter.id,
      ...(chapter.number !== undefined ? { number: chapter.number } : {}),
      ...(chapter.volume ? { volume: chapter.volume } : {}),
      ...(chapter.title ? { chapterTitle: chapter.title } : {}),
      translatedLanguage: chapter.translatedLanguage,
      groups: chapter.groups.map(({ id, name }) => ({ id, name })),
      ...(chapter.sourceLabel ? { sourceLabel: chapter.sourceLabel } : {}),
    },
  };
}

function key(chapter: MangaDexReaderChapter): string {
  return chapterDownloadKey(chapter.source === "mirror" ? "mirror" : "mangadex", chapter.id);
}

/**
 * The round download button at the end of a chapter row, with the same states as an episode's:
 * download; waiting; a ring filling page by page (select to pause); paused; failed (amber, select
 * to retry); and a check once it reads offline.
 */
export function ChapterDownloadToggle({
  media,
  chapter,
}: {
  media: AniListCatalogMedia;
  chapter: MangaDexReaderChapter;
}): React.JSX.Element | null {
  const downloads = useOptionalDownloads();
  if (!downloads) return null;
  const item = downloads.byChapter.get(key(chapter));
  const label = `chapter ${chapter.number ?? "?"}`;
  const className = "episode-download-toggle chapter-download-toggle";
  if (!item)
    return (
      <button
        type="button"
        className={className}
        aria-label={`Download ${label}`}
        title="Download to read offline"
        onClick={() => void downloads.addChapters([chapterRequest(media, chapter)])}
      >
        <Download size={15} aria-hidden="true" />
      </button>
    );
  if (item.status === "done")
    return (
      <span
        className={`${className} is-done`}
        role="img"
        aria-label={`Chapter ${chapter.number ?? "?"} is downloaded`}
        title="Downloaded: reads offline"
      >
        <Check size={15} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  const progress = item.pagesTotal ? Math.min(1, item.pagesDone / item.pagesTotal) : 0;
  const active = item.status === "downloading" || item.status === "queued";
  return (
    <button
      type="button"
      className={`${className} is-${item.status}`}
      aria-label={
        active
          ? `Pause download of ${label}, ${Math.round(progress * 100)}%`
          : `Continue download of ${label}`
      }
      title={
        item.status === "failed"
          ? (item.error ?? "Download failed: select to retry")
          : active
            ? `${item.status === "queued" ? "Waiting" : "Downloading"} ${Math.round(progress * 100)}%: select to pause`
            : (item.error ?? "Paused: select to continue")
      }
      onClick={() =>
        void downloads.apply({
          op: active ? "pause" : item.status === "failed" ? "retry" : "resume",
          id: item.id,
        })
      }
    >
      {item.status === "downloading" || item.status === "paused" ? (
        <ProgressRing value={progress} />
      ) : null}
      {item.status === "queued" ? (
        <Clock3 size={14} aria-hidden="true" />
      ) : item.status === "downloading" ? (
        <Pause size={11} fill="currentColor" aria-hidden="true" />
      ) : item.status === "paused" ? (
        <Play size={11} fill="currentColor" aria-hidden="true" />
      ) : (
        <RotateCcw size={14} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * The chapter list's Download: a dialog offering the next unread chapters or all of them (one
 * release per chapter, the preferred group first), with a rough size, before anything starts.
 */
export function MangaDownloadButton({
  media,
  session,
  readThrough,
}: {
  media: AniListCatalogMedia;
  session: MangaDexReaderSession;
  /** Chapters up to this number count as read. */
  readThrough: number;
}): React.JSX.Element | null {
  const downloads = useOptionalDownloads();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
  }, [open]);

  if (!downloads || session.status !== "available" || !session.chapters.length) return null;
  const sequence = buildLogicalChapterSequence(session.chapters, session.preferredGroupId);
  const unread = sequence.filter(
    (chapter) => chapter.number === undefined || Math.floor(chapter.number) > readThrough,
  );
  const missing = unread
    .filter((chapter) => !downloads.byChapter.has(key(chapter)))
    .slice(0, MAX_CHAPTER_BATCH);
  const next = missing.slice(0, NEXT_BATCH);
  const all = missing.length === 0;
  const close = (): void => dialog.current?.close();
  const queue = (chapters: MangaDexReaderChapter[]): void => {
    close();
    void downloads.addChapters(chapters.map((chapter) => chapterRequest(media, chapter)));
  };

  return (
    <>
      <button
        type="button"
        className="chapter-sort"
        aria-haspopup="dialog"
        title={all ? "Every unread chapter is downloaded or queued" : "Download to read offline"}
        onClick={() => setOpen(true)}
      >
        {all ? (
          <CircleCheck size={15} aria-hidden="true" />
        ) : (
          <Download size={15} aria-hidden="true" />
        )}
        {all ? "Downloaded" : "Download"}
      </button>
      {/* Rendered on the body: inside the chapter toolbar, its button styles would win. */}
      {open
        ? createPortal(
            <dialog
              ref={dialog}
              className="download-dialog"
              aria-labelledby={titleId}
              onClose={() => setOpen(false)}
              onClick={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div className="download-dialog-body">
                <header>
                  <h2 id={titleId}>Download chapters</h2>
                  <button
                    type="button"
                    className="download-dialog-close"
                    aria-label="Close"
                    onClick={close}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>
                <p className="download-dialog-title">{media.title}</p>
                {all ? (
                  <p>Every unread chapter is downloaded or in the queue.</p>
                ) : (
                  <>
                    <p>
                      Download <strong>{missing.length}</strong> unread{" "}
                      {missing.length === 1 ? "chapter" : "chapters"} at original quality, about{" "}
                      <strong>{formatBytes(missing.length * CHAPTER_ESTIMATE_BYTES)}</strong>.
                    </p>
                    <p className="download-dialog-note">
                      Chapters download one page at a time and read offline in AniStream. Single
                      chapters can be downloaded from their rows.
                    </p>
                    <div className="download-dialog-actions">
                      <button type="button" className="download-dialog-cancel" onClick={close}>
                        Cancel
                      </button>
                      {missing.length > NEXT_BATCH ? (
                        <button
                          type="button"
                          className="download-dialog-cancel"
                          onClick={() => queue(next)}
                        >
                          Next {NEXT_BATCH}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="download-dialog-confirm"
                        onClick={() => queue(missing)}
                      >
                        <Download size={15} aria-hidden="true" />
                        Download all{missing.length > NEXT_BATCH ? ` ${missing.length}` : ""}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
