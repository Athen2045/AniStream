import { RefreshCw, UserRound } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type {
  AniListAuthState,
  AniListCatalogMedia,
  AniListDashboard,
  AniListEntry,
  AniListEntryStatus,
  AniListMedia,
  AniListMediaType,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { CatalogView } from "./CatalogView";
import { CoverImage } from "./CoverImage";
import { GlobalSearch } from "./GlobalSearch";
import { safeBackgroundUrl } from "./safe-css-url";

// Only needed once a title is opened, never on initial launch -- load it as its own
// chunk instead of paying its parse/compile cost during startup.
const MediaDetailModal = lazy(() =>
  import("./MediaDetailModal").then((module) => ({ default: module.MediaDetailModal })),
);

const ENTRY_STATUSES: Array<{ value: AniListEntryStatus; label: string }> = [
  { value: "CURRENT", label: "Current" },
  { value: "PLANNING", label: "Planning" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PAUSED", label: "Paused" },
  { value: "DROPPED", label: "Dropped" },
  { value: "REPEATING", label: "Repeating" },
];

type LibrarySort = "UPDATED_DESC" | "TITLE_ASC" | "SCORE_DESC" | "PROGRESS_DESC";

export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<AniListAuthState>({ status: "signed-out" });
  const [dashboard, setDashboard] = useState<AniListDashboard>();
  const [view, setView] = useState<"ANIME" | "MANGA" | "PROFILE">("ANIME");
  const [browseQuery, setBrowseQuery] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<AniListCatalogMedia>();
  const [selectedAction, setSelectedAction] = useState<"details" | "play" | "read">("details");
  const [mediaType, setMediaType] = useState<AniListMediaType>("ANIME");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("UPDATED_DESC");
  const [adding, setAdding] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<AniListMedia[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [addingMediaId, setAddingMediaId] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();

  const loadDashboard = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setError(undefined);
    try {
      const next = await window.anistream.getAniListDashboard();
      setDashboard(next);
      setSelectedGroup((current) => current || next.animeLists[0]?.name || "");
    } catch (reason) {
      setError(
        messageFrom(
          reason,
          "Unable to refresh your AniList lists. Your saved login remains active.",
        ),
      );
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const applyAuthState = (state: AniListAuthState): void => {
      if (!mounted) return;
      setAuth(state);
      setError(state.status === "error" ? state.message : undefined);
      if (state.status === "signed-in") {
        setDashboard((current) => current ?? emptyDashboard(state));
        void window.anistream
          .getCachedAniListDashboard()
          .then((cached) => {
            if (!mounted || !cached || cached.profile.id !== state.profile.id) return;
            setDashboard(cached);
            setSelectedGroup((current) => current || cached.animeLists[0]?.name || "");
            setLoading(false);
          })
          .catch(() => undefined)
          .finally(() => {
            if (mounted) void loadDashboard();
          });
      } else if (state.status === "signed-out") {
        setDashboard(undefined);
        setLoading(false);
      } else if (state.status !== "authorizing") {
        setLoading(false);
      }
    };

    void window.anistream
      .getAniListAuthState()
      .then(applyAuthState)
      .catch((reason: unknown) => {
        setError(messageFrom(reason, "Unable to read the saved AniList session."));
        setLoading(false);
      });
    const unsubscribe = window.anistream.onAniListAuthChanged(applyAuthState);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [loadDashboard]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".global-search input")?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const groups = mediaType === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
  const activeGroup = useMemo(
    () => groups?.find((group) => group.name === selectedGroup) ?? groups?.[0],
    [groups, selectedGroup],
  );
  const visibleEntries = useMemo(() => {
    const query = listQuery.trim().toLocaleLowerCase();
    const filtered = query
      ? (activeGroup?.entries ?? []).filter((entry) =>
          entry.media.title.toLocaleLowerCase().includes(query),
        )
      : (activeGroup?.entries ?? []);
    return [...filtered].sort((left, right) => {
      if (librarySort === "TITLE_ASC") {
        return left.media.title.localeCompare(right.media.title);
      }
      if (librarySort === "SCORE_DESC") return right.score - left.score;
      if (librarySort === "PROGRESS_DESC") return right.progress - left.progress;
      return right.updatedAt - left.updatedAt;
    });
  }, [activeGroup, librarySort, listQuery]);
  const libraryMediaIds = useMemo(() => {
    const ids = new Set<number>();
    for (const list of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])]) {
      for (const entry of list.entries) ids.add(entry.media.id);
    }
    return ids;
  }, [dashboard]);
  // Keyed by media id (not list-entry id) so catalog/rail cards can look up whether a
  // given title is already on the list, and if so, its real list-entry id for removal.
  const libraryEntries = useMemo(() => {
    const map = new Map<number, AniListEntry>();
    for (const list of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])]) {
      for (const entry of list.entries) map.set(entry.media.id, entry);
    }
    return map;
  }, [dashboard]);

  function switchMediaType(type: AniListMediaType): void {
    setMediaType(type);
    setListQuery("");
    setCatalogResults([]);
    const nextGroups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    setSelectedGroup(nextGroups?.[0]?.name ?? "");
  }

  async function connect(): Promise<void> {
    setError(undefined);
    try {
      await window.anistream.startAniListLogin();
    } catch (reason) {
      setError(messageFrom(reason, "Unable to start AniList sign-in."));
    }
  }

  async function saveEntry(input: UpdateAniListEntryInput): Promise<void> {
    setError(undefined);
    await window.anistream.updateAniListEntry(input);
    await loadDashboard();
  }

  async function deleteEntry(entry: AniListEntry): Promise<void> {
    if (!window.confirm(`Remove “${entry.media.title}” from your AniList?`)) return;
    await window.anistream.deleteAniListEntry(entry.id);
    await loadDashboard();
  }

  async function quickAddToLibrary(media: AniListCatalogMedia): Promise<void> {
    await window.anistream.addAniListEntry(media.id);
    await loadDashboard();
  }

  async function searchCatalog(): Promise<void> {
    setCatalogSearching(true);
    setError(undefined);
    try {
      setCatalogResults(await window.anistream.searchAniList(catalogQuery, mediaType));
    } catch (reason) {
      setError(messageFrom(reason, "AniList search failed."));
    } finally {
      setCatalogSearching(false);
    }
  }

  async function addMedia(media: AniListMedia): Promise<void> {
    setAddingMediaId(media.id);
    try {
      await window.anistream.addAniListEntry(media.id);
      await loadDashboard();
      setAdding(false);
      setCatalogQuery("");
      setCatalogResults([]);
    } finally {
      setAddingMediaId(undefined);
    }
  }

  if (loading) return <LoadingScreen label="Restoring your AniList session…" />;

  if (auth.status !== "signed-in" || !dashboard) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">Your library, in one place</p>
          <h1>AniStream</h1>
          <p className="login-copy">
            Connect your AniList account once. AniStream keeps the encrypted session until you
            explicitly log out.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => void connect()}
            disabled={auth.status === "authorizing"}
          >
            {auth.status === "authorizing" ? "Finish in your browser…" : "Continue with AniList"}
          </button>
          <p className="privacy-note">
            The access token and cached profile are encrypted using macOS Keychain-backed storage
            and never exposed to the page UI.
          </p>
          {error ? <p className="error-banner">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <nav className="app-navbar">
        <button className="wordmark" type="button" onClick={() => openCatalog("ANIME")}>
          <span>A</span>AniStream
        </button>
        <div className="nav-links" aria-label="Main navigation">
          <button
            className={view === "ANIME" ? "active" : ""}
            type="button"
            onClick={() => openCatalog("ANIME")}
          >
            Anime
          </button>
          <button
            className={view === "MANGA" ? "active" : ""}
            type="button"
            onClick={() => openCatalog("MANGA")}
          >
            Manga
          </button>
        </div>
        <GlobalSearch
          onSelect={(media) => openMedia(media, "details")}
          onSubmit={(query) => {
            setBrowseQuery(query);
            if (view === "PROFILE") setView("ANIME");
          }}
        />
        <div className="nav-account">
          <button type="button" aria-label="Refresh AniList" onClick={() => void loadDashboard()}>
            <RefreshCw size={17} className={syncing ? "spinning" : ""} />
          </button>
          <button
            className={`avatar-button ${view === "PROFILE" ? "active" : ""}`}
            type="button"
            onClick={() => setView("PROFILE")}
            aria-label="Open profile"
          >
            {dashboard.profile.avatarUrl ? (
              <img src={dashboard.profile.avatarUrl} alt="" decoding="async" />
            ) : (
              <UserRound size={17} />
            )}
          </button>
        </div>
      </nav>

      {view === "ANIME" || view === "MANGA" ? (
        <CatalogView
          type={view}
          searchQuery={browseQuery}
          dashboard={dashboard}
          libraryEntries={libraryEntries}
          onSelect={(media) => openMedia(media, "details")}
          onPrimary={(media) => openMedia(media, view === "ANIME" ? "play" : "read")}
          onQuickAdd={quickAddToLibrary}
          onQuickRemove={deleteEntry}
        />
      ) : (
        <ProfileView
          dashboard={dashboard}
          mediaType={mediaType}
          selectedGroup={selectedGroup}
          activeGroupName={activeGroup?.name}
          visibleEntries={visibleEntries}
          listQuery={listQuery}
          librarySort={librarySort}
          adding={adding}
          catalogQuery={catalogQuery}
          catalogResults={catalogResults}
          catalogSearching={catalogSearching}
          addingMediaId={addingMediaId}
          libraryMediaIds={libraryMediaIds}
          syncing={syncing}
          error={error}
          onSwitchType={switchMediaType}
          onSelectGroup={setSelectedGroup}
          onListQuery={setListQuery}
          onLibrarySort={setLibrarySort}
          onToggleAdding={() => setAdding((value) => !value)}
          onCatalogQuery={setCatalogQuery}
          onCatalogSearch={searchCatalog}
          onAdd={addMedia}
          onSave={saveEntry}
          onDelete={deleteEntry}
          onRefresh={loadDashboard}
          onLogout={async () => window.anistream.logoutAniList()}
        />
      )}

      <Suspense
        fallback={
          selectedMedia ? (
            <div className="modal-suspense-fallback" role="status" aria-label="Loading details">
              <span className="loading-orbit" aria-hidden="true" />
            </div>
          ) : null
        }
      >
        <AnimatePresence mode="wait">
          {selectedMedia ? (
            <MediaDetailModal
              key={`${selectedMedia.type}:${selectedMedia.id}`}
              media={selectedMedia}
              initialAction={selectedAction}
              onClose={() => {
                setSelectedMedia(undefined);
                setSelectedAction("details");
              }}
              onAdded={loadDashboard}
            />
          ) : null}
        </AnimatePresence>
      </Suspense>
    </main>
  );

  function openCatalog(type: "ANIME" | "MANGA"): void {
    setBrowseQuery("");
    setView(type);
  }

  function openMedia(media: AniListCatalogMedia, action: "details" | "play" | "read"): void {
    if (action !== "details") {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    setSelectedAction(action);
    setSelectedMedia(media);
  }
}

function ProfileView({
  dashboard,
  mediaType,
  selectedGroup,
  activeGroupName,
  visibleEntries,
  listQuery,
  librarySort,
  adding,
  catalogQuery,
  catalogResults,
  catalogSearching,
  addingMediaId,
  libraryMediaIds,
  syncing,
  error,
  onSwitchType,
  onSelectGroup,
  onListQuery,
  onLibrarySort,
  onToggleAdding,
  onCatalogQuery,
  onCatalogSearch,
  onAdd,
  onSave,
  onDelete,
  onRefresh,
  onLogout,
}: {
  dashboard: AniListDashboard;
  mediaType: AniListMediaType;
  selectedGroup: string;
  activeGroupName?: string;
  visibleEntries: AniListEntry[];
  listQuery: string;
  librarySort: LibrarySort;
  adding: boolean;
  catalogQuery: string;
  catalogResults: AniListMedia[];
  catalogSearching: boolean;
  addingMediaId?: number;
  libraryMediaIds: Set<number>;
  syncing: boolean;
  error?: string;
  onSwitchType: (type: AniListMediaType) => void;
  onSelectGroup: (name: string) => void;
  onListQuery: (value: string) => void;
  onLibrarySort: (value: LibrarySort) => void;
  onToggleAdding: () => void;
  onCatalogQuery: (value: string) => void;
  onCatalogSearch: () => Promise<void>;
  onAdd: (media: AniListMedia) => Promise<void>;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onDelete: (entry: AniListEntry) => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}): React.JSX.Element {
  const groups = mediaType === "ANIME" ? dashboard.animeLists : dashboard.mangaLists;

  return (
    <>
      <header
        className="profile-hero"
        style={
          dashboard.profile.bannerUrl
            ? {
                backgroundImage: `linear-gradient(90deg, #0b0d13 8%, rgba(11,13,19,.82) 50%, rgba(11,13,19,.35)), ${safeBackgroundUrl(dashboard.profile.bannerUrl)}`,
              }
            : undefined
        }
      >
        <div className="profile-summary">
          <img
            className="profile-avatar"
            src={dashboard.profile.avatarUrl}
            alt={`${dashboard.profile.name}'s avatar`}
            decoding="async"
          />
          <div>
            <p className="eyebrow">AniList profile</p>
            <h1>{dashboard.profile.name}</h1>
            {dashboard.profile.about ? (
              <p className="profile-about">{stripMarkup(dashboard.profile.about)}</p>
            ) : null}
          </div>
        </div>
        <div className="profile-stats" aria-label="AniList statistics">
          <ProfileStat value={dashboard.profile.animeCount} label="Anime" />
          <ProfileStat value={dashboard.profile.episodesWatched} label="Episodes" />
          <ProfileStat value={formatMinutes(dashboard.profile.minutesWatched)} label="Watch time" />
          <ProfileStat value={dashboard.profile.mangaCount} label="Manga" />
          <ProfileStat value={dashboard.profile.chaptersRead} label="Chapters" />
          <ProfileStat value={dashboard.profile.volumesRead} label="Volumes" />
        </div>
      </header>

      <section className="library-shell">
        <div className="profile-session-actions">
          <button className="quiet-button" type="button" onClick={() => void onRefresh()}>
            {syncing ? "Syncing…" : "Refresh AniList"}
          </button>
          <button className="quiet-button danger" type="button" onClick={() => void onLogout()}>
            Log out
          </button>
        </div>
        <div className="library-toolbar">
          <div className="media-tabs" role="tablist" aria-label="Library type">
            <button
              className={mediaType === "ANIME" ? "active" : ""}
              type="button"
              onClick={() => onSwitchType("ANIME")}
            >
              Anime list
            </button>
            <button
              className={mediaType === "MANGA" ? "active" : ""}
              type="button"
              onClick={() => onSwitchType("MANGA")}
            >
              Manga list
            </button>
          </div>
          <select
            className="library-sort"
            value={librarySort}
            onChange={(event) => onLibrarySort(event.target.value as LibrarySort)}
            aria-label={`Sort ${mediaType === "ANIME" ? "anime" : "manga"} list`}
          >
            <option value="UPDATED_DESC">Latest updated</option>
            <option value="TITLE_ASC">Title A–Z</option>
            <option value="SCORE_DESC">Highest score</option>
            <option value="PROGRESS_DESC">Most progress</option>
          </select>
          <input
            className="library-search"
            value={listQuery}
            onChange={(event) => onListQuery(event.target.value)}
            placeholder={`Filter ${mediaType === "ANIME" ? "anime" : "manga"}…`}
          />
          <button className="add-title-button" type="button" onClick={onToggleAdding}>
            {adding ? "Close search" : "Add title"}
          </button>
        </div>

        {adding ? (
          <section className="catalog-search">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCatalogSearch();
              }}
            >
              <input
                value={catalogQuery}
                onChange={(event) => onCatalogQuery(event.target.value)}
                placeholder={`Search AniList ${mediaType === "ANIME" ? "anime" : "manga"}…`}
                autoFocus
              />
              <button type="submit" disabled={catalogSearching || catalogQuery.trim().length < 2}>
                {catalogSearching ? "Searching…" : "Search AniList"}
              </button>
            </form>
            <div className="catalog-results">
              {catalogResults.map((media) => {
                const added = libraryMediaIds.has(media.id);
                return (
                  <article key={media.id}>
                    <CoverImage src={media.coverUrl} title={media.title} />
                    <div>
                      <span>{formatMediaFormat(media.format)}</span>
                      <strong>{media.title}</strong>
                    </div>
                    <button
                      type="button"
                      disabled={added || addingMediaId === media.id}
                      onClick={() => void onAdd(media)}
                    >
                      {added ? "In list" : addingMediaId === media.id ? "Adding…" : "Add"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="group-tabs" role="tablist" aria-label="AniList groups">
          {groups.map((group) => (
            <button
              className={group.name === activeGroupName ? "active" : ""}
              type="button"
              key={`${mediaType}-${group.name}`}
              onClick={() => onSelectGroup(group.name)}
            >
              {group.name}
              <span>{group.entries.length}</span>
            </button>
          ))}
        </div>
        {error ? <p className="error-banner">{error}</p> : null}
        <div className="library-heading">
          <div>
            <p className="eyebrow">AniList library</p>
            <h2>{activeGroupName ?? (selectedGroup || "No list")}</h2>
          </div>
          <span>{visibleEntries.length} titles</span>
        </div>
        <div className="media-grid">
          {visibleEntries.map((entry) => (
            <MediaCard entry={entry} key={entry.id} onSave={onSave} onDelete={onDelete} />
          ))}
        </div>
        {!visibleEntries.length ? (
          <div className="empty-state">
            <h3>Nothing here yet</h3>
            <p>{listQuery ? "Try another filter." : "This AniList group has no titles."}</p>
          </div>
        ) : null}
      </section>
    </>
  );
}

function MediaCard({
  entry,
  onSave,
  onDelete,
}: {
  entry: AniListEntry;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onDelete: (entry: AniListEntry) => Promise<void>;
}): React.JSX.Element {
  const [status, setStatus] = useState(entry.status);
  const [progress, setProgress] = useState(entry.progress);
  const [score, setScore] = useState(entry.score);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const progressLabel = entry.media.type === "ANIME" ? "episodes watched" : "chapters read";

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await onSave({
        id: entry.id,
        status,
        progress: Math.max(0, progress),
        score: Math.min(10, Math.max(0, score)),
        notes,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="media-card">
      <div className="cover-wrap">
        <img src={entry.media.coverUrl} alt="" loading="lazy" />
        <button
          className="progress-button"
          type="button"
          disabled={saving}
          onClick={() => {
            const next = Math.min(
              entry.media.totalProgress ?? Number.MAX_SAFE_INTEGER,
              progress + 1,
            );
            setProgress(next);
            void onSave({ id: entry.id, progress: next });
          }}
        >
          +1
        </button>
      </div>
      <div className="media-card-body">
        <p className="media-meta">{formatMediaFormat(entry.media.format)}</p>
        <h3 title={entry.media.title}>{entry.media.title}</h3>
        <p className="progress-copy">
          {progress}
          {entry.media.totalProgress ? ` / ${entry.media.totalProgress}` : ""} {progressLabel}
        </p>
        <div className="score-row">
          <span>{statusLabel(status)}</span>
          <strong>{score ? `${score}/10` : "—"}</strong>
        </div>
        <button className="edit-button" type="button" onClick={() => setEditing((value) => !value)}>
          {editing ? "Close editor" : "Edit entry"}
        </button>
        {editing ? (
          <div className="entry-editor">
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as AniListEntryStatus)}
              >
                {ENTRY_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="editor-row">
              <label>
                Progress
                <input
                  type="number"
                  min="0"
                  max={entry.media.totalProgress}
                  value={progress}
                  onChange={(event) => setProgress(Number(event.target.value))}
                />
              </label>
              <label>
                Score
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={score}
                  onChange={(event) => setScore(Number(event.target.value))}
                />
              </label>
            </div>
            <label>
              Notes
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
            </label>
            <div className="editor-actions">
              <button
                className="save-button"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save to AniList"}
              </button>
              <button className="delete-button" type="button" onClick={() => void onDelete(entry)}>
                Remove
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function emptyDashboard(
  state: Extract<AniListAuthState, { status: "signed-in" }>,
): AniListDashboard {
  return {
    profile: state.profile,
    animeLists: [],
    mangaLists: [],
    fetchedAt: new Date().toISOString(),
  };
}

function ProfileStat({
  value,
  label,
}: {
  value: number | string;
  label: string;
}): React.JSX.Element {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }): React.JSX.Element {
  return (
    <main className="loading-screen">
      <div className="loading-orbit" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}

function statusLabel(status: AniListEntryStatus): string {
  return ENTRY_STATUSES.find((option) => option.value === status)?.label ?? status;
}

function formatMediaFormat(format?: string): string {
  return format?.replaceAll("_", " ").toLocaleLowerCase() ?? "media";
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const days = Math.floor(minutes / 1_440);
  return days ? `${days.toLocaleString()}d` : `${Math.floor(minutes / 60).toLocaleString()}h`;
}

function stripMarkup(markup: string): string {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return document.body.textContent?.trim() ?? "";
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
