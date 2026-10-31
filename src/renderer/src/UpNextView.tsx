import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ListPlus,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  bingeItemTarget,
  type BingeEntry,
  type BingeItem,
  type BingeListRef,
  type BingePlaylist,
} from "../../shared/binge";
import { useBinge } from "./BingeProvider";
import { bingeItemArt, bingeItemTitle } from "./binge-session";
import { CoverImage } from "./CoverImage";
import { Toggle } from "./SettingsControls";
import { NameForm } from "./UpNextNameForm";

type Tab = "queue" | "playlists";

/** Up Next (plays in order, empties as items start) and saved playlists. */
export function UpNextView(): React.JSX.Element {
  const { session, state, autoplay, setAutoplay, play, playNext } = useBinge();
  const [tab, setTab] = useState<Tab>("queue");
  const [openPlaylistId, setOpenPlaylistId] = useState<number>();
  const openPlaylist = state.playlists.find((playlist) => playlist.id === openPlaylistId);
  const count = (value: number, noun: string): string =>
    `${value} ${noun}${value === 1 ? "" : "s"}`;
  const summary =
    tab === "queue"
      ? state.queue.length
        ? `${count(state.queue.length, "title")} queued`
        : "Plays in order, then empties"
      : state.playlists.length
        ? count(state.playlists.length, "playlist")
        : "Saved lists to play later";

  return (
    <section className="upnext-page page-rise" aria-labelledby="upnext-heading">
      <header className="page-head">
        <div className="page-head-title">
          <h1 id="upnext-heading">Up Next</h1>
          <p className="page-head-sub">{summary}</p>
        </div>
        <div className="page-head-actions">
          <span className="upnext-autoplay">
            <Toggle label="Autoplay next" checked={autoplay} onChange={setAutoplay} />
            <span aria-hidden="true">Autoplay next</span>
          </span>
          <div className="segmented" role="tablist" aria-label="Up Next sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "queue"}
              onClick={() => setTab("queue")}
            >
              Up Next <span className="segmented-count">{state.queue.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "playlists"}
              onClick={() => {
                setTab("playlists");
                setOpenPlaylistId(undefined);
              }}
            >
              Playlists <span className="segmented-count">{state.playlists.length}</span>
            </button>
          </div>
        </div>
      </header>

      {state.error ? (
        <p className="upnext-error" role="alert">
          {state.error}
          <button type="button" aria-label="Dismiss" onClick={() => session.dismissError()}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      ) : null}

      {tab === "queue" ? (
        <QueuePanel
          entries={state.queue}
          loaded={state.loaded}
          onPlayAll={() => playNext()}
          onSave={(name) => void session.apply({ op: "create-playlist", name, fromQueue: true })}
          onClear={() => void session.apply({ op: "clear", target: { list: "queue" } })}
          onPlay={(entry) => play(entry, true)}
        />
      ) : openPlaylist ? (
        <PlaylistPanel
          playlist={openPlaylist}
          onBack={() => setOpenPlaylistId(undefined)}
          onPlayAll={() =>
            void session
              .apply({ op: "queue-playlist", id: openPlaylist.id })
              .then((saved) => saved && playNext())
          }
          onPlay={(entry) => play(entry, false)}
          onRename={(name) =>
            void session.apply({ op: "rename-playlist", id: openPlaylist.id, name })
          }
          onDelete={() => {
            setOpenPlaylistId(undefined);
            void session.apply({ op: "delete-playlist", id: openPlaylist.id });
          }}
        />
      ) : (
        <PlaylistGrid
          playlists={state.playlists}
          onOpen={setOpenPlaylistId}
          onCreate={(name) => void session.apply({ op: "create-playlist", name, fromQueue: false })}
          onPlay={(playlist) =>
            void session
              .apply({ op: "queue-playlist", id: playlist.id })
              .then((saved) => saved && playNext())
          }
        />
      )}
    </section>
  );
}

function QueuePanel({
  entries,
  loaded,
  onPlayAll,
  onSave,
  onClear,
  onPlay,
}: {
  entries: BingeEntry[];
  loaded: boolean;
  onPlayAll: () => void;
  onSave: (name: string) => void;
  onClear: () => void;
  onPlay: (entry: BingeEntry) => void;
}): React.JSX.Element {
  const [naming, setNaming] = useState(false);
  const { session } = useBinge();
  if (!loaded) return <p className="upnext-empty">Loading Up Next…</p>;
  if (!entries.length)
    return (
      <div className="upnext-empty">
        <ListPlus size={28} aria-hidden="true" />
        <strong>Nothing queued</strong>
        <span>
          Choose <em>Up Next</em> on any anime, show or movie page. Titles play in order and leave
          the queue as they start.
        </span>
      </div>
    );
  const [first] = entries;
  const firstTitle = bingeItemTitle(first!.item);
  return (
    <>
      <article className="upnext-feature" aria-labelledby="upnext-feature-title">
        <CoverImage src={wideArt(first!.item)} title={firstTitle} className="upnext-feature-art" />
        <div className="upnext-feature-copy">
          <p className="upnext-feature-label">Playing next</p>
          <h2 id="upnext-feature-title">{firstTitle}</h2>
          <p className="upnext-feature-meta">{entryMeta(first!.item)}</p>
          <div className="upnext-feature-actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={onPlayAll}>
              <Play size={18} aria-hidden="true" />
              Play
            </button>
            {naming ? (
              <NameForm
                label="Playlist name"
                submitLabel="Save"
                onSubmit={(name) => {
                  onSave(name);
                  setNaming(false);
                }}
                onCancel={() => setNaming(false)}
              />
            ) : (
              <button type="button" className="btn btn--lg" onClick={() => setNaming(true)}>
                <Plus size={18} aria-hidden="true" />
                Save as playlist
              </button>
            )}
            <button type="button" className="btn btn--lg btn--ghost" onClick={onClear}>
              <Trash2 size={18} aria-hidden="true" />
              Clear
            </button>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--icon btn--ghost upnext-feature-remove"
          aria-label={`Remove ${firstTitle}`}
          title="Remove"
          onClick={() =>
            void session.apply({ op: "remove", target: { list: "queue" }, key: first!.key })
          }
        >
          <X size={18} aria-hidden="true" />
        </button>
      </article>
      {entries.length > 1 ? (
        <EntryList entries={entries} from={1} target={{ list: "queue" }} onPlay={onPlay} />
      ) : null}
    </>
  );
}

/** The widest artwork a queued item has: the AniList banner or TMDB backdrop, else its poster. */
function wideArt(item: BingeItem): string | undefined {
  return item.kind === "anime"
    ? (item.media.bannerUrl ?? item.media.coverUrl)
    : (item.title.backdropUrl ?? item.title.posterUrl);
}

/** "Anime · Episode 5", "Show · S2 E3", or "Movie". */
function entryMeta(item: BingeItem): string {
  const kind = item.kind === "anime" ? "Anime" : item.title.type === "MOVIE" ? "Movie" : "Show";
  return kind === "Movie" ? kind : `${kind} · ${bingeItemTarget(item)}`;
}

function PlaylistGrid({
  playlists,
  onOpen,
  onCreate,
  onPlay,
}: {
  playlists: BingePlaylist[];
  onOpen: (id: number) => void;
  onCreate: (name: string) => void;
  onPlay: (playlist: BingePlaylist) => void;
}): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="upnext-actions">
        {creating ? (
          <NameForm
            label="New playlist name"
            submitLabel="Create"
            onSubmit={(name) => {
              onCreate(name);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New playlist
          </button>
        )}
      </div>
      {playlists.length ? (
        <div className="upnext-playlists">
          {playlists.map((playlist) => (
            <article className="upnext-playlist" key={playlist.id}>
              <button
                type="button"
                className="upnext-playlist-open"
                onClick={() => onOpen(playlist.id)}
                aria-label={`Open ${playlist.name}, ${playlist.entries.length} titles`}
              >
                <span className="upnext-mosaic" aria-hidden="true">
                  {playlist.entries.slice(0, 4).map((entry) => (
                    <CoverImage key={entry.key} src={bingeItemArt(entry.item)} />
                  ))}
                </span>
                <strong>{playlist.name}</strong>
                <span>
                  {playlist.entries.length} {playlist.entries.length === 1 ? "title" : "titles"}
                </span>
              </button>
              <button
                type="button"
                className="upnext-playlist-play"
                aria-label={`Play ${playlist.name}`}
                title="Play"
                disabled={!playlist.entries.length}
                onClick={() => onPlay(playlist)}
              >
                <Play size={16} fill="currentColor" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="upnext-empty">
          <strong>No playlists yet</strong>
          <span>Create one here, save your Up Next, or add titles from their pages.</span>
        </div>
      )}
    </>
  );
}

function PlaylistPanel({
  playlist,
  onBack,
  onPlayAll,
  onPlay,
  onRename,
  onDelete,
}: {
  playlist: BingePlaylist;
  onBack: () => void;
  onPlayAll: () => void;
  onPlay: (entry: BingeEntry) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div className="upnext-playlist-head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Playlists
        </button>
        {renaming ? (
          <NameForm
            label="Playlist name"
            submitLabel="Rename"
            initial={playlist.name}
            onSubmit={(name) => {
              onRename(name);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h2>{playlist.name}</h2>
        )}
      </div>
      <div className="upnext-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!playlist.entries.length}
          onClick={onPlayAll}
        >
          <Play size={16} aria-hidden="true" />
          Play playlist
        </button>
        <button type="button" className="btn" onClick={() => setRenaming(true)}>
          <Pencil size={16} aria-hidden="true" />
          Rename
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn upnext-danger" onClick={onDelete}>
              Delete “{playlist.name}”
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            <Trash2 size={16} aria-hidden="true" />
            Delete
          </button>
        )}
      </div>
      <p className="upnext-hint">
        Playing a playlist replaces Up Next with a copy; the playlist itself stays as it is.
      </p>
      {playlist.entries.length ? (
        <EntryList
          entries={playlist.entries}
          target={{ list: "playlist", id: playlist.id }}
          onPlay={onPlay}
        />
      ) : (
        <div className="upnext-empty">
          <strong>This playlist is empty</strong>
          <span>Add titles from their pages with Up Next → this playlist.</span>
        </div>
      )}
    </>
  );
}

/** The ledger of queued titles; Up Next starts it at the second (the first is the card above). */
function EntryList({
  entries,
  from = 0,
  target,
  onPlay,
}: {
  entries: BingeEntry[];
  from?: number;
  target: BingeListRef;
  onPlay: (entry: BingeEntry) => void;
}): React.JSX.Element {
  const { session } = useBinge();
  return (
    <ol className="ledger upnext-list" start={from + 1}>
      {entries.slice(from).map((entry, offset) => {
        const index = from + offset;
        const title = bingeItemTitle(entry.item);
        return (
          <li key={entry.key} className="upnext-row">
            <span className="upnext-index">{index + 1}</span>
            <button
              type="button"
              className="upnext-row-main"
              onClick={() => onPlay(entry)}
              aria-label={`Play ${title}, ${bingeItemTarget(entry.item)}`}
            >
              <CoverImage src={wideArt(entry.item)} title={title} className="upnext-thumb" />
              <span className="upnext-row-copy">
                <strong>{title}</strong>
                <span>{entryMeta(entry.item)}</span>
              </span>
            </button>
            <span className="upnext-row-tools">
              <button
                type="button"
                className="btn btn--icon btn--ghost"
                aria-label={`Move ${title} up`}
                title="Move up"
                disabled={index === 0}
                onClick={() =>
                  void session.apply({ op: "move", target, key: entry.key, index: index - 1 })
                }
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn--icon btn--ghost"
                aria-label={`Move ${title} down`}
                title="Move down"
                disabled={index === entries.length - 1}
                onClick={() =>
                  void session.apply({ op: "move", target, key: entry.key, index: index + 1 })
                }
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn--icon btn--ghost"
                aria-label={`Remove ${title}`}
                title="Remove"
                onClick={() => void session.apply({ op: "remove", target, key: entry.key })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
