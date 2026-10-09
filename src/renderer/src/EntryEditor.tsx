import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Minus, Plus, RefreshCw, X } from "lucide-react";
import type {
  AniListEntry,
  AniListEntryStatus,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { formatMediaLabel } from "./format-label";
import { statusLabel } from "./profile-library";
import { usePersonalLibrary } from "./PersonalLibraryProvider";

const STATUSES: AniListEntryStatus[] = [
  "CURRENT",
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "PLANNING",
  "REPEATING",
];

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
  const anime = entry.media.type === "ANIME";
  // Earlier changes still waiting (or no network) means this save will be queued on the device.
  const { state: libraryState } = usePersonalLibrary();
  const offline =
    libraryState.pending > 0 || (typeof navigator !== "undefined" && navigator.onLine === false);
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
        <div className="entry-editor-band" aria-hidden="true">
          {entry.media.bannerUrl || entry.media.coverUrl ? (
            <img
              className={entry.media.bannerUrl ? undefined : "is-cover"}
              src={entry.media.bannerUrl ?? entry.media.coverUrl}
              alt=""
            />
          ) : null}
        </div>
        <button
          className="entry-editor-close"
          type="button"
          aria-label="Close editor"
          title="Close editor"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <header className="entry-editor-header">
          <CoverImage src={entry.media.coverUrl} title={entry.media.title} />
          <div>
            <span>
              {formatMediaLabel(entry.media.format, anime ? "Anime" : "Manga")}
              {entry.media.totalProgress
                ? ` · ${entry.media.totalProgress} ${anime ? "episodes" : "chapters"}`
                : ""}
            </span>
            <h2 id="entry-editor-title">{entry.media.title}</h2>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="entry-editor-fields" disabled={busy}>
            <div className="entry-editor-field">
              <span id="entry-status-label">Status</span>
              <div
                className="entry-status-chips"
                role="radiogroup"
                aria-labelledby="entry-status-label"
              >
                {STATUSES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={status === value}
                    className={status === value ? "is-active" : undefined}
                    onClick={() => setStatus(value)}
                  >
                    {statusLabel(value, anime)}
                  </button>
                ))}
              </div>
            </div>
            <div className="editor-row">
              <Stepper
                label={anime ? "Episodes watched" : "Chapters read"}
                value={progress}
                min={0}
                max={entry.media.totalProgress}
                step={1}
                onChange={setProgress}
              />
              <Stepper
                label="Your score"
                value={score}
                min={0}
                max={10}
                step={0.5}
                onChange={setScore}
              />
            </div>
            <label className="entry-editor-field">
              <span>Notes</span>
              <textarea
                value={notes}
                placeholder="Add a private note…"
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
              />
            </label>
            {offline ? (
              <p className="entry-editor-offline" role="status">
                <RefreshCw size={15} aria-hidden="true" />
                <span>
                  <b>AniList is unreachable.</b> Saving keeps this change on this device and shows
                  it right away; AniStream sends it to AniList automatically when it is back.
                </span>
              </p>
            ) : null}
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
              Remove from library
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="save-button title-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : offline ? "Save on this device" : "Save changes"}
            </button>
          </footer>
        </form>
      </motion.section>
    </motion.div>,
    document.body,
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const clamp = (next: number) =>
    Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Math.round(next / step) * step));
  return (
    <label className="entry-editor-field">
      <span>{label}</span>
      <span className="entry-stepper">
        <button
          type="button"
          aria-label={`Decrease ${label.toLocaleLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          <Minus size={15} />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          required
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {max !== undefined ? <small>/ {max}</small> : null}
        <button
          type="button"
          aria-label={`Increase ${label.toLocaleLowerCase()}`}
          disabled={max !== undefined && value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          <Plus size={15} />
        </button>
      </span>
    </label>
  );
}
