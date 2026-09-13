import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import type {
  AniListEntry,
  AniListEntryStatus,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";
import { useAppReducedMotion } from "./useAppReducedMotion";

export function EntryEditor({
  entry,
  onSave,
  onDelete,
  onClose,
}: {
  entry: AniListEntry;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onDelete: (entry: AniListEntry) => Promise<boolean>;
  onClose: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState(entry.status);
  const [progress, setProgress] = useState(entry.progress);
  const [score, setScore] = useState(entry.score);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLElement>(null);
  const callbacks = useRef({ busy, onClose });
  useEffect(() => {
    callbacks.current = { busy, onClose };
  }, [busy, onClose]);
  const reducedMotion = useAppReducedMotion();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!callbacks.current.busy) callbacks.current.onClose();
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary",
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", keys, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>(".library-toolbar button, .avatar-button")
          ?.focus({ preventScroll: true });
    };
  }, []);
  async function submit(remove = false): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (remove) {
        if (await onDelete(entry)) onClose();
      } else {
        await onSave({ id: entry.id, status, progress, score, notes });
        onClose();
      }
    } catch (reason) {
      setError(
        friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "library changes",
          fallback: "Your changes could not be saved. The values you entered are still here.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <motion.div
      className="entry-editor-backdrop"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={motionTransition(reducedMotion, "fast")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.section
        className="entry-editor"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="entry-editor-title"
        initial={reducedMotion ? false : { y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={motionTransition(reducedMotion)}
      >
        <header className="entry-editor-header">
          <CoverImage src={entry.media.coverUrl} title={entry.media.title} />
          <div>
            <span>Your library · {entry.media.type === "ANIME" ? "Anime" : "Manga"}</span>
            <h2 id="entry-editor-title">{entry.media.title}</h2>
          </div>
          <button
            type="button"
            aria-label="Close editor"
            title="Close editor"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="entry-editor-fields" disabled={busy}>
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as AniListEntryStatus)}
              >
                {(
                  [
                    "CURRENT",
                    "PLANNING",
                    "COMPLETED",
                    "PAUSED",
                    "DROPPED",
                    "REPEATING",
                  ] as AniListEntryStatus[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {value === "CURRENT"
                      ? entry.media.type === "ANIME"
                        ? "Watching"
                        : "Reading"
                      : value[0] + value.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <div className="editor-row">
              <label>
                Progress {entry.media.totalProgress ? `/ ${entry.media.totalProgress}` : ""}
                <input
                  type="number"
                  min={0}
                  max={entry.media.totalProgress}
                  step={1}
                  required
                  value={progress}
                  onChange={(event) => setProgress(Number(event.target.value))}
                />
              </label>
              <label>
                Score / 10
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  required
                  value={score}
                  onChange={(event) => setScore(Number(event.target.value))}
                />
              </label>
            </div>
            <details className="editor-notes" open={notes ? true : undefined}>
              <summary>Notes (optional)</summary>
              <label>
                <span className="sr-only">Notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                />
              </label>
            </details>
          </fieldset>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="editor-actions">
            <button
              className="delete-button"
              type="button"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Remove
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="save-button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </motion.section>
    </motion.div>,
    document.body,
  );
}
