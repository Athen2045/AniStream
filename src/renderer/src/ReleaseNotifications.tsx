import { Check, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { usePersonalLibrary } from "./PersonalLibraryProvider";

const READ_BELL =
  "M9.35419 21C10.0593 21.6224 10.9856 22 12 22C13.0145 22 13.9407 21.6224 14.6458 21M18 8C18 6.4087 17.3679 4.88258 16.2427 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.8826 2.63214 7.75738 3.75736C6.63216 4.88258 6.00002 6.4087 6.00002 8C6.00002 11.0902 5.22049 13.206 4.34968 14.6054C3.61515 15.7859 3.24788 16.3761 3.26134 16.5408C3.27626 16.7231 3.31488 16.7926 3.46179 16.9016C3.59448 17 4.19261 17 5.38887 17H18.6112C19.8074 17 20.4056 17 20.5382 16.9016C20.6852 16.7926 20.7238 16.7231 20.7387 16.5408C20.7522 16.3761 20.3849 15.7859 19.6504 14.6054C18.7795 13.206 18 11.0902 18 8Z";
const UNREAD_BELL =
  "M9.35419 21C10.0593 21.6224 10.9856 22 12 22C13.0145 22 13.9407 21.6224 14.6458 21M18 8V2M15 5H21M13 2.08389C12.6717 2.02841 12.3373 2 12 2C10.4087 2 8.8826 2.63214 7.75738 3.75736C6.63216 4.88258 6.00002 6.4087 6.00002 8C6.00002 11.0902 5.22049 13.206 4.34968 14.6054C3.61515 15.7859 3.24788 16.3761 3.26134 16.5408C3.27626 16.7231 3.31488 16.7926 3.46179 16.9016C3.59448 17 4.19261 17 5.38887 17H18.6112C19.8074 17 20.4055 17 20.5382 16.9016C20.6851 16.7926 20.7237 16.7231 20.7386 16.5408C20.7521 16.3761 20.3848 15.7858 19.6502 14.6052C19.1582 13.8144 18.6953 12.7948 18.3857 11.5";

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
        <NotificationBellIcon unread={unread > 0} />
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

export function NotificationBellIcon({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={unread ? UNREAD_BELL : READ_BELL}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
