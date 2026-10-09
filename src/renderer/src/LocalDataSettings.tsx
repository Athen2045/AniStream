import { Download, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RestorePreview, RestoreSummary } from "../../shared/local-backup";

function additions(summary: RestoreSummary): number {
  return (
    summary.titles +
    summary.mangaPreferences +
    summary.upNextItems +
    summary.playlists +
    Number(summary.readerSettings)
  );
}

function Summary({
  summary,
  restored = false,
}: {
  summary: RestoreSummary;
  restored?: boolean;
}): React.JSX.Element {
  const upNext = summary.upNextItems + summary.playlists;
  return (
    <>
      <ul className="set-counts">
        <li>
          <strong>{summary.titles}</strong>
          {summary.titles === 1 ? "title" : "titles"} with history or resume points
        </li>
        <li>
          <strong>{upNext}</strong>
          Up Next {upNext === 1 ? "title or playlist" : "titles and playlists"}
        </li>
        <li>
          <strong>{summary.mangaPreferences}</strong>
          manga language/group {summary.mangaPreferences === 1 ? "preference" : "preferences"}
        </li>
      </ul>
      <p className="set-hint">
        Reader layout and image quality:{" "}
        {summary.readerSettings
          ? restored
            ? "saved settings restored"
            : "saved settings added"
          : "current settings kept"}
        . {summary.keptExisting} existing {summary.keptExisting === 1 ? "item" : "items"} kept.
      </p>
    </>
  );
}

/** Settings → Backup: export this device's local data, or add what a backup has that is missing. */
export function LocalDataSettings(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [result, setResult] = useState<RestoreSummary | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const token = useRef<string | undefined>(undefined);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (token.current)
        void window.anistream.cancelLocalRestore(token.current).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (preview) reviewHeading.current?.focus();
  }, [preview]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      await action();
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error ? error.message : "The backup operation failed. Try again.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const exportBackup = (): Promise<void> =>
    run(async () => {
      const saved = await window.anistream.exportLocalBackup();
      if (mounted.current) setMessage(saved ? "Backup saved." : "Export canceled.");
    });
  const chooseRestore = (): Promise<void> =>
    run(async () => {
      const next = await window.anistream.prepareLocalRestore();
      if (!mounted.current) {
        if (next) await window.anistream.cancelLocalRestore(next.token);
        return;
      }
      token.current = next?.token;
      setPreview(next);
      if (!next) setMessage("Restore canceled.");
    });
  const restore = (current: RestorePreview): Promise<void> =>
    run(async () => {
      let restored: RestoreSummary;
      try {
        restored = await window.anistream.restoreLocalBackup(current.token);
      } finally {
        token.current = undefined;
        if (mounted.current) {
          setPreview(null);
          requestAnimationFrame(() => restoreButton.current?.focus());
        }
      }
      if (mounted.current) {
        setResult(restored);
        setMessage(
          additions(restored)
            ? "Restore complete. New reader preferences apply the next time you open a chapter."
            : "Nothing added. All items already have local data.",
        );
      }
    });
  const cancelRestore = (current: RestorePreview): Promise<void> =>
    run(async () => {
      await window.anistream.cancelLocalRestore(current.token);
      token.current = undefined;
      setPreview(null);
      setMessage("Restore canceled.");
      requestAnimationFrame(() => restoreButton.current?.focus());
    });

  return (
    <div className="set-card local-data-settings">
      <div className="set-row">
        <div className="set-text">
          <strong>Back up this device</strong>
          <span>
            History, resume points, Up Next, and reader preferences, saved as an unencrypted JSON
            file. Your AniList lists are already kept on AniList.
          </span>
        </div>
        <button
          type="button"
          className="set-button"
          disabled={busy || !!preview}
          onClick={() => void exportBackup()}
        >
          <Download size={15} aria-hidden="true" />
          Export
        </button>
        <button
          ref={restoreButton}
          type="button"
          className="set-button"
          disabled={busy || !!preview}
          onClick={() => void chooseRestore()}
        >
          <Upload size={15} aria-hidden="true" />
          Restore
        </button>
      </div>
      {preview ? (
        <section className="set-review" aria-labelledby="backup-review-title">
          <h3 ref={reviewHeading} tabIndex={-1} id="backup-review-title">
            Adds only what’s missing
          </h3>
          <p className="set-hint">
            Backup from {new Date(preview.exportedAt).toLocaleString()}. Progress and preferences
            already on this device stay as they are, and restored history is not sent to AniList.
          </p>
          <Summary summary={preview.summary} />
          <div className="set-review-actions">
            <button
              type="button"
              className="set-button set-button--primary"
              disabled={busy || additions(preview.summary) === 0}
              onClick={() => void restore(preview)}
            >
              Add {additions(preview.summary)} {additions(preview.summary) === 1 ? "item" : "items"}
            </button>
            <button
              type="button"
              className="set-button set-button--quiet"
              disabled={busy}
              onClick={() => void cancelRestore(preview)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      {/* Always present so screen readers hear each result. */}
      <p className="set-status" role="status" aria-live="polite">
        {busy ? "Working…" : message}
      </p>
      {result ? (
        <div className="set-feedback">
          <Summary summary={result} restored />
        </div>
      ) : null}
      {error ? (
        <p className="error-banner set-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
