import { Check, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { usePersonalLibrary } from "./PersonalLibraryProvider";

const READ_BELL =
  "M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z";
const UNREAD_BELL =
  "M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80Zm0-420ZM160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v13q-11 22-16 45t-4 47q-10-2-19.5-3.5T480-720q-66 0-113 47t-47 113v280h320v-257q18 8 38.5 12.5T720-520v240h80v80H160Zm475-435q-35-35-35-85t35-85q35-35 85-35t85 35q35 35 35 85t-35 85q-35 35-85 35t-85-35Z";

export function ReleaseNotifications({
  onSelect,
}: {
  onSelect: (media: AniListCatalogMedia) => void;
}) {
  const { session, state } = usePersonalLibrary();
  const [open, setOpen] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const unread = state.releases.length;
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      className="release-notifications"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="notification-trigger"
        ref={trigger}
        aria-label={
          unread
            ? `Notifications, ${unread} unread update${unread === 1 ? "" : "s"}`
            : "Notifications, no unread updates"
        }
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        title="Notifications"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void session.refresh();
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 -960 960 960"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={unread ? UNREAD_BELL : READ_BELL} />
        </svg>
      </button>
      {open ? (
        <div
          className="notification-panel"
          id={id}
          ref={panel}
          role="dialog"
          aria-labelledby={`${id}-title`}
          tabIndex={-1}
        >
          <header className="notification-heading">
            <div>
              <h2 id={`${id}-title`}>Your updates</h2>
              <span>{unread ? `${unread} unread` : "All caught up"}</span>
            </div>
            <button
              type="button"
              aria-label="Refresh personal updates"
              disabled={state.loading}
              onClick={() => {
                setRefreshSpin((spin) => spin + 1);
                void session.refresh(true);
              }}
            >
              <RefreshCw
                key={refreshSpin}
                size={16}
                className={refreshSpin ? "refresh-spin-once" : undefined}
                aria-hidden="true"
              />
            </button>
          </header>
          {state.error ? (
            <p className="notification-status" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.loading ? (
            <p className="notification-status" role="status">
              Checking your titles…
            </p>
          ) : null}
          {unread ? (
            <div className="notification-list" aria-label="Unread anime and manga updates">
              {state.releases.map((release, index) => (
                <article className="notification-item" key={release.key}>
                  <button
                    type="button"
                    className="notification-open"
                    onClick={() => {
                      setOpen(false);
                      onSelect(release.media);
                    }}
                  >
                    <CoverImage src={release.media.coverUrl} className="notification-cover" />
                    <span className="notification-copy">
                      <strong>{release.media.title}</strong>
                      <span>
                        {release.kind === "aired"
                          ? `Episode ${release.unit} aired · Anime`
                          : `Chapter ${release.unit} · ${release.language?.toUpperCase()} · Manga`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="notification-seen"
                    aria-label={`Mark ${release.media.title} update as seen`}
                    title="Mark as seen"
                    disabled={state.acknowledging.includes(release.key)}
                    onClick={() => {
                      void session.acknowledge(release).then((saved) => {
                        if (!saved) return;
                        requestAnimationFrame(() => {
                          const rows =
                            panel.current?.querySelectorAll<HTMLButtonElement>(
                              ".notification-open",
                            );
                          const next = rows?.[Math.min(index, rows.length - 1)];
                          (next ?? panel.current)?.focus();
                        });
                      });
                    }}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          ) : !state.loading ? (
            <p className="notification-empty">
              {state.error
                ? "Updates are unavailable right now."
                : "No unread updates for your anime or manga."}
            </p>
          ) : null}
          <footer>Marking an update as seen keeps your watch and read progress unchanged.</footer>
        </div>
      ) : null}
    </div>
  );
}
