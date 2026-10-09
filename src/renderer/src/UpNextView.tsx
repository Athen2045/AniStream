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
  BINGE_NAME_MAX,
  type BingeEntry,
  type BingeListRef,
  type BingePlaylist,
} from "../../shared/binge";
import { useBinge } from "./BingeProvider";
import { bingeItemArt, bingeItemTitle } from "./binge-session";
import { CoverImage } from "./CoverImage";

type Tab = "queue" | "playlists";

/** Up Next (plays in order, empties as items start) and saved playlists. */
export function UpNextView(): React.JSX.Element {
  const { session, state, autoplay, setAutoplay, play, playNext } = useBinge();
  const [tab, setTab] = useState<Tab>("queue");
  const [openPlaylistId, setOpenPlaylistId] = useState<number>();
  const openPlaylist = state.playlists.find((playlist) => playlist.id === openPlaylistId);

  return (
    <section className="upnext-page" aria-labelledby="upnext-heading">
      <header className="upnext-header">
        <div>
          <h1 id="upnext-heading">Up Next</h1>
          <p>Queue anime, shows, and movies to watch in order, or keep playlists for later.</p>
        </div>
        <label className="upnext-autoplay">
          <input
            type="checkbox"
            role="switch"
            checked={autoplay}
            onChange={(event) => setAutoplay(event.target.checked)}
          />
          <span className="upnext-switch" aria-hidden="true" />
          Autoplay next
        </label>
      </header>

      <div className="upnext-tabs" role="tablist" aria-label="Up Next sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queue"}
          onClick={() => setTab("queue")}
        >
          Up Next <span>{state.queue.length}</span>
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
          Playlists <span>{state.playlists.length}</span>
        </button>
      </div>

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
  if (!loaded) return <p className="upnext-empty">Loading Up Next…</p>;
  if (!entries.length)
    return (
      <div className="upnext-empty">
        <ListPlus size={28} aria-hidden="true" />
        <strong>Nothing queued</strong>
        <span>
          Choose <em>Up Next</em> on any anime, show, or movie page. Items play in order and leave
          the queue as they start.
        </span>
      </div>
    );
  return (
    <>
      <div className="upnext-actions">
        <button type="button" className="upnext-primary" onClick={onPlayAll}>
          <Play size={16} fill="currentColor" aria-hidden="true" />
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
          <button type="button" onClick={() => setNaming(true)}>
            <Plus size={16} aria-hidden="true" />
            Save as playlist
          </button>
        )}
        <button type="button" onClick={onClear}>
          <Trash2 size={15} aria-hidden="true" />
          Clear
        </button>
      </div>
      <EntryList entries={entries} target={{ list: "queue" }} onPlay={onPlay} />
    </>
  );
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
          <button type="button" className="upnext-primary" onClick={() => setCreating(true)}>
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
        <button type="button" className="upnext-back" onClick={onBack}>
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
          className="upnext-primary"
          disabled={!playlist.entries.length}
          onClick={onPlayAll}
        >
          <Play size={16} fill="currentColor" aria-hidden="true" />
          Play playlist
        </button>
        <button type="button" onClick={() => setRenaming(true)}>
          <Pencil size={15} aria-hidden="true" />
          Rename
        </button>
        {confirming ? (
          <>
            <button type="button" className="upnext-danger" onClick={onDelete}>
              Delete “{playlist.name}”
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            <Trash2 size={15} aria-hidden="true" />
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

function EntryList({
  entries,
  target,
  onPlay,
}: {
  entries: BingeEntry[];
  target: BingeListRef;
  onPlay: (entry: BingeEntry) => void;
}): React.JSX.Element {
  const { session } = useBinge();
  return (
    <ol className="upnext-list">
      {entries.map((entry, index) => {
        const title = bingeItemTitle(entry.item);
        const kind =
          entry.item.kind === "anime"
            ? "Anime"
            : entry.item.title.type === "MOVIE"
              ? "Movie"
              : "Show";
        return (
          <li key={entry.key} className="upnext-row">
            <span className="upnext-index">{index + 1}</span>
            <button
              type="button"
              className="upnext-row-main"
              onClick={() => onPlay(entry)}
              aria-label={`Play ${title}, ${bingeItemTarget(entry.item)}`}
            >
              <CoverImage src={bingeItemArt(entry.item)} title={title} className="upnext-cover" />
              <span className="upnext-row-copy">
                <strong>{title}</strong>
                <span>{kind === "Movie" ? kind : `${kind} · ${bingeItemTarget(entry.item)}`}</span>
              </span>
              <Play size={16} fill="currentColor" className="upnext-row-play" aria-hidden="true" />
            </button>
            <span className="upnext-row-tools">
              <button
                type="button"
                aria-label={`Move ${title} up`}
                title="Move up"
                disabled={index === 0}
                onClick={() =>
                  void session.apply({ op: "move", target, key: entry.key, index: index - 1 })
                }
              >
                <ArrowUp size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move ${title} down`}
                title="Move down"
                disabled={index === entries.length - 1}
                onClick={() =>
                  void session.apply({ op: "move", target, key: entry.key, index: index + 1 })
                }
              >
                <ArrowDown size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${title}`}
                title="Remove"
                onClick={() => void session.apply({ op: "remove", target, key: entry.key })}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function NameForm({
  label,
  submitLabel,
  initial = "",
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <form
      className="upnext-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={BINGE_NAME_MAX}
        // Opened by an explicit click, so moving focus into the field is expected.
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" disabled={!trimmed}>
        {submitLabel}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
