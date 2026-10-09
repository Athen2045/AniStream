import { Check, ListChecks, ListEnd, ListPlus, ListStart, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { bingeItemKey, type BingeItem } from "../../shared/binge";
import { useOptionalBinge } from "./BingeProvider";
import { NameForm } from "./UpNextView";
import { useAppPreferences } from "./app-preferences";

/**
 * Title-page control: queue the title (next or last) or add it to a playlist. Renders nothing
 * outside the app's Up Next provider (isolated tests and harnesses).
 */
export function UpNextButton({
  item,
  className,
}: {
  item: BingeItem;
  className?: string;
}): React.JSX.Element | null {
  const binge = useOptionalBinge();
  const { upNext } = useAppPreferences();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [notice, setNotice] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const clear = window.setTimeout(() => setNotice(undefined), 2400);
    return () => window.clearTimeout(clear);
  }, [notice]);

  // Settings → Customize can turn Up Next off; saved lists are kept.
  if (!binge || !upNext) return null;
  const { session, state } = binge;
  const key = bingeItemKey(item);
  const queued = state.queue.some((entry) => entry.key === key);

  const run = (change: Parameters<typeof session.apply>[0], done: string): void => {
    setOpen(false);
    setNaming(false);
    void session.apply(change).then((saved) => saved && setNotice(done));
  };

  return (
    <div className="upnext-menu-root" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={queued ? "In Up Next" : "Add to Up Next or a playlist"}
        onClick={() => setOpen((value) => !value)}
      >
        {queued ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <ListPlus size={17} aria-hidden="true" />
        )}
        {notice ?? (queued ? "In Up Next" : "Up Next")}
      </button>
      {open ? (
        <div className="upnext-menu" id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              run({ op: "add", target: { list: "queue" }, item, position: "next" }, "Playing next")
            }
          >
            <ListStart size={16} aria-hidden="true" />
            Play next
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              run({ op: "add", target: { list: "queue" }, item, position: "end" }, "Added")
            }
          >
            <ListEnd size={16} aria-hidden="true" />
            {queued ? "Move to end of Up Next" : "Add to end of Up Next"}
          </button>
          <div className="upnext-menu-heading" role="presentation">
            Playlists
          </div>
          {state.playlists.map((playlist) => {
            const inList = playlist.entries.some((entry) => entry.key === key);
            return (
              <button
                key={playlist.id}
                type="button"
                role="menuitem"
                disabled={inList}
                onClick={() =>
                  run(
                    {
                      op: "add",
                      target: { list: "playlist", id: playlist.id },
                      item,
                      position: "end",
                    },
                    `Added to ${playlist.name}`,
                  )
                }
              >
                {inList ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <span className="upnext-menu-dot" />
                )}
                <span className="upnext-menu-label">{playlist.name}</span>
              </button>
            );
          })}
          {naming ? (
            <NameForm
              label="New playlist name"
              submitLabel="Create"
              onSubmit={(name) => {
                // Create, then add this title to the newest playlist (the list is newest first).
                setOpen(false);
                setNaming(false);
                void session
                  .apply({ op: "create-playlist", name, fromQueue: false })
                  .then((saved) => {
                    const created = saved ? session.getSnapshot().playlists[0] : undefined;
                    if (!created) return;
                    void session
                      .apply({
                        op: "add",
                        target: { list: "playlist", id: created.id },
                        item,
                        position: "end",
                      })
                      .then((added) => added && setNotice(`Added to ${created.name}`));
                  });
              }}
              onCancel={() => setNaming(false)}
            />
          ) : (
            <button type="button" role="menuitem" onClick={() => setNaming(true)}>
              <Plus size={16} aria-hidden="true" />
              New playlist…
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Corner toggle on an episode tile: one click queues that exact episode at the end of Up Next,
 * a second click takes it out again. Renders nothing outside the Up Next provider.
 */
export function EpisodeQueueToggle({
  item,
  label,
}: {
  item: BingeItem;
  /** "Episode 3" or "S1 · E3", used in the button's accessible name. */
  label: string;
}): React.JSX.Element | null {
  const binge = useOptionalBinge();
  const { upNext } = useAppPreferences();
  if (!binge || !upNext) return null;
  const { session, state } = binge;
  const key = bingeItemKey(item);
  const queued = state.queue.some((entry) => entry.key === key);
  return (
    <button
      type="button"
      className={`episode-queue-toggle${queued ? " is-queued" : ""}`}
      aria-pressed={queued}
      aria-label={queued ? `Remove ${label} from Up Next` : `Add ${label} to Up Next`}
      title={queued ? "In Up Next (select to remove)" : "Add to Up Next"}
      onClick={(event) => {
        event.stopPropagation();
        void session.apply(
          queued
            ? { op: "remove", target: { list: "queue" }, key }
            : { op: "add", target: { list: "queue" }, item, position: "end" },
        );
      }}
    >
      {queued ? (
        <ListChecks size={15} aria-hidden="true" />
      ) : (
        <ListPlus size={15} aria-hidden="true" />
      )}
    </button>
  );
}
