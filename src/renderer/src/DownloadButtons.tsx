import { Check, CircleCheck, Clock3, Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";
import {
  downloadKey,
  estimateDownloadBytes,
  formatBytes,
  type DownloadEpisodeRequest,
} from "../../shared/downloads";
import { useOptionalDownloads } from "./DownloadsProvider";

function request(
  media: AniListCatalogMedia,
  episode: number,
  minutes?: number,
): DownloadEpisodeRequest {
  return {
    aniListId: media.id,
    episode,
    title: media.title,
    ...(/^https:\/\//.test(media.coverUrl) ? { coverUrl: media.coverUrl } : {}),
    ...(minutes ? { minutes } : {}),
  };
}

/**
 * The round download button beside an episode's title (redesign 2026-10-18): download; waiting
 * (dashed, select to pause); a ring filling with progress (select to pause); paused (select to
 * continue); failed (amber, select to retry); and a green check once it plays offline.
 */
export function EpisodeDownloadToggle({
  media,
  episode,
  minutes,
}: {
  media: AniListCatalogMedia;
  episode: number;
  minutes?: number;
}): React.JSX.Element | null {
  const downloads = useOptionalDownloads();
  if (!downloads) return null;
  const item = downloads.byEpisode.get(downloadKey(media.id, episode));
  const label = `episode ${episode}`;
  if (!item)
    return (
      <button
        type="button"
        className="episode-download-toggle"
        aria-label={`Download ${label}`}
        title="Download to watch offline"
        onClick={(event) => {
          event.stopPropagation();
          void downloads.add([request(media, episode, minutes)]);
        }}
      >
        <Download size={15} aria-hidden="true" />
      </button>
    );
  if (item.status === "done")
    return (
      <span
        className="episode-download-toggle is-done"
        role="img"
        aria-label={`Episode ${episode} is downloaded`}
        title="Downloaded: plays offline"
      >
        <Check size={15} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  const progress = item.bytesExpected ? Math.min(1, item.bytesDone / item.bytesExpected) : 0;
  const active = item.status === "downloading" || item.status === "queued";
  return (
    <button
      type="button"
      className={`episode-download-toggle is-${item.status}`}
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
            : "Paused: select to continue"
      }
      onClick={(event) => {
        event.stopPropagation();
        void downloads.apply({
          op: active ? "pause" : item.status === "failed" ? "retry" : "resume",
          id: item.id,
        });
      }}
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

function ProgressRing({ value }: { value: number }): React.JSX.Element {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="download-ring" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r={radius} className="download-ring-track" />
      <circle
        cx="15"
        cy="15"
        r={radius}
        className="download-ring-value"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
      />
    </svg>
  );
}

/** Title-page action: download every aired episode not already downloaded or queued. */
/**
 * The title page's Download: a centred dialog (above everything, so nothing on the page can cut it
 * off) that says how many episodes, at which quality and roughly how big, before anything starts.
 */
export function TitleDownloadButton({
  media,
  airedEpisodes,
  minutes,
  className,
}: {
  media: AniListCatalogMedia;
  airedEpisodes: number;
  minutes?: number;
  className?: string;
}): React.JSX.Element | null {
  const downloads = useOptionalDownloads();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
  }, [open]);

  if (!downloads || airedEpisodes < 1) return null;
  const missing = Array.from(
    { length: Math.min(airedEpisodes, 200) },
    (_, index) => index + 1,
  ).filter((episode) => !downloads.byEpisode.has(downloadKey(media.id, episode)));
  const quality = downloads.state?.settings.quality ?? "1080p";
  const estimate = missing.length * estimateDownloadBytes(minutes ?? 24, quality);
  const all = missing.length === 0;
  const close = (): void => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        title={all ? "Every aired episode is downloaded or queued" : "Download to watch offline"}
        onClick={() => setOpen(true)}
      >
        {all ? (
          <CircleCheck size={16} aria-hidden="true" />
        ) : (
          <Download size={16} aria-hidden="true" />
        )}
        {all ? "Downloaded" : "Download"}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          className="download-dialog"
          aria-labelledby={titleId}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            // A click on the backdrop (the dialog element itself) closes it.
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="download-dialog-body">
            <header>
              <h2 id={titleId}>Download episodes</h2>
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
              <p>All {airedEpisodes} aired episodes are downloaded or in the queue.</p>
            ) : (
              <>
                <p>
                  Download <strong>{missing.length}</strong>{" "}
                  {missing.length === 1 ? "episode" : "episodes"} at {quality}, up to{" "}
                  <strong>{formatBytes(estimate)}</strong>.
                </p>
                <p className="download-dialog-note">
                  Episodes come from the backup player and play offline in AniStream. Single
                  episodes can be downloaded from their tiles.
                </p>
                <div className="download-dialog-actions">
                  <button type="button" className="download-dialog-cancel" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="download-dialog-confirm"
                    onClick={() => {
                      close();
                      void downloads.add(
                        missing.map((episode) => request(media, episode, minutes)),
                      );
                    }}
                  >
                    <Download size={15} aria-hidden="true" />
                    Download {missing.length === airedEpisodes ? "all" : "the rest"}
                  </button>
                </div>
              </>
            )}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
