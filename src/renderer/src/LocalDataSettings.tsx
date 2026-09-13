import { useEffect, useRef, useState } from "react";
import type { RestorePreview, RestoreSummary } from "../../shared/local-backup";

function additions(summary: RestoreSummary): number {
  return (
    summary.titles +
    summary.mangaPreferences +
    summary.releaseAcknowledgements +
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
  return (
    <ul className="local-data-summary">
      <li>
        {summary.titles} {summary.titles === 1 ? "title" : "titles"} with local history or resume
        points
      </li>
      <li>
        {summary.mangaPreferences} manga language/group{" "}
        {summary.mangaPreferences === 1 ? "preference" : "preferences"}
      </li>
      <li>
        {summary.releaseAcknowledgements} dismissed release{" "}
        {summary.releaseAcknowledgements === 1 ? "notice" : "notices"}
      </li>
      <li>
        Reader layout and image quality:{" "}
        {summary.readerSettings
          ? restored
            ? "saved settings restored"
            : "add saved settings"
          : "current settings kept"}
      </li>
      <li>
        {summary.keptExisting} existing {summary.keptExisting === 1 ? "item" : "items"} kept
      </li>
    </ul>
  );
}

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
  return (
    <details className="local-data-settings">
      <summary>Local progress and backups</summary>
      <div className="local-data-content">
        <p>
          Keep a copy of this device’s watch/read history, resume points, reader preferences, and
          dismissed release notices.
        </p>
        <p className="muted">
          Includes locally recorded activity across sign-ins. Account connections, AniList lists,
          For You feedback, and catalog caches are excluded. The JSON file is unencrypted.
        </p>
        <div className="local-data-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !!preview}
            onClick={() =>
              void run(async () => {
                const saved = await window.anistream.exportLocalBackup();
                if (mounted.current) setMessage(saved ? "Backup saved." : "Export canceled.");
              })
            }
          >
            Export backup
          </button>
          <button
            ref={restoreButton}
            type="button"
            className="secondary-button"
            disabled={busy || !!preview}
            onClick={() =>
              void run(async () => {
                const next = await window.anistream.prepareLocalRestore();
                if (!mounted.current) {
                  if (next) await window.anistream.cancelLocalRestore(next.token);
                  return;
                }
                token.current = next?.token;
                setPreview(next);
                if (!next) setMessage("Restore canceled.");
              })
            }
          >
            Choose backup to restore
          </button>
        </div>
        {busy ? <p role="status">Working…</p> : null}
        {preview ? (
          <section className="local-data-review" aria-labelledby="backup-review-title">
            <h3 ref={reviewHeading} tabIndex={-1} id="backup-review-title">
              Review restore
            </h3>
            <p>Backup from {new Date(preview.exportedAt).toLocaleString()}.</p>
            <Summary summary={preview.summary} />
            <p>
              Only missing items will be added. Existing progress and saved preferences stay as they
              are. Imported history stays local and is not queued for AniList sync. Counts are
              checked again when you restore.
            </p>
            <div className="local-data-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || additions(preview.summary) === 0}
                onClick={() =>
                  void run(async () => {
                    let restored: RestoreSummary;
                    try {
                      restored = await window.anistream.restoreLocalBackup(preview.token);
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
                  })
                }
              >
                Add missing items
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.anistream.cancelLocalRestore(preview.token);
                    token.current = undefined;
                    setPreview(null);
                    setMessage("Restore canceled.");
                    requestAnimationFrame(() => restoreButton.current?.focus());
                  })
                }
              >
                Cancel restore
              </button>
            </div>
          </section>
        ) : null}
        <p role="status" aria-live="polite">
          {message}
        </p>
        {result ? <Summary summary={result} restored /> : null}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
