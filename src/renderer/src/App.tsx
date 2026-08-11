import { LogOut, MoreHorizontal, Plus, RefreshCw, Search, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type {
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
import { ProfileConnectView } from "./ProfileConnectView";
import { safeBackgroundUrl } from "./safe-css-url";
import { formatMediaLabel } from "./format-label";
import { isProgressComplete } from "../../shared/progress";
import { mediaDetailInstanceKey } from "./viewer-access";
import { createViewerSession } from "./viewer-session";

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
  const reducedMotion = useReducedMotion();
  const viewerSession = useMemo(() => createViewerSession(window.anistream), []);
  const viewerSnapshot = useSyncExternalStore(
    viewerSession.subscribe,
    viewerSession.getSnapshot,
    viewerSession.getSnapshot,
  );
  const auth = viewerSnapshot.auth;
  const viewerAccess = viewerSnapshot.access;
  const dashboard = viewerAccess.kind === "member" ? viewerAccess.dashboard : undefined;
  const authRestoring = viewerSnapshot.restoring;
  const syncing = viewerSnapshot.syncing;
  const [localError, setLocalError] = useState<string>();
  const error = viewerSnapshot.error ?? localError;
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

  useEffect(() => {
    void viewerSession.restore();
    return () => viewerSession.dispose();
  }, [viewerSession]);

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
  function switchMediaType(type: AniListMediaType): void {
    setMediaType(type);
    setListQuery("");
    setCatalogResults([]);
    const nextGroups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    setSelectedGroup(nextGroups?.[0]?.name ?? "");
  }

  async function connect(): Promise<void> {
    await viewerSession.connect();
  }

  async function cancelConnect(): Promise<void> {
    await viewerSession.cancelConnect();
  }

  async function saveEntry(input: UpdateAniListEntryInput): Promise<void> {
    const access = viewerSession.getSnapshot().access;
    if (access.kind === "member") await access.updateEntry(input);
  }

  async function deleteEntry(entry: AniListEntry): Promise<void> {
    if (!window.confirm(`Remove “${entry.media.title}” from your AniList?`)) return;
    const access = viewerSession.getSnapshot().access;
    if (access.kind === "member") await access.removeFromLibrary(entry);
  }

  async function searchCatalog(): Promise<void> {
    setCatalogSearching(true);
    setLocalError(undefined);
    try {
      setCatalogResults(await window.anistream.searchAniList(catalogQuery, mediaType));
    } catch (reason) {
      setLocalError(messageFrom(reason, "AniList search failed."));
    } finally {
      setCatalogSearching(false);
    }
  }

  async function addMedia(media: AniListMedia): Promise<void> {
    setAddingMediaId(media.id);
    try {
      const access = viewerSession.getSnapshot().access;
      if (access.kind !== "member") throw new Error("Connect AniList to manage your library.");
      await access.addToLibrary(media);
      setAdding(false);
      setCatalogQuery("");
      setCatalogResults([]);
    } finally {
      setAddingMediaId(undefined);
    }
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
          {viewerAccess.kind === "member" ? (
            <>
              <button
                type="button"
                aria-label="Refresh AniList"
                onClick={() => void viewerSession.refresh()}
              >
                <RefreshCw size={17} className={syncing ? "spinning" : ""} />
              </button>
              <button
                className={`avatar-button ${view === "PROFILE" ? "active" : ""}`}
                type="button"
                onClick={() => setView("PROFILE")}
                aria-label="Open profile"
              >
                {viewerAccess.dashboard.profile.avatarUrl ? (
                  <img src={viewerAccess.dashboard.profile.avatarUrl} alt="" decoding="async" />
                ) : (
                  <UserRound size={17} />
                )}
              </button>
            </>
          ) : (
            <button
              className={`session-button ${view === "PROFILE" ? "active" : ""}`}
              type="button"
              onClick={() => setView("PROFILE")}
              aria-label="Open profile and connect AniList"
            >
              <UserRound size={17} />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        {view === "ANIME" || view === "MANGA" ? (
          <motion.div
            className="route-view"
            key={`catalog-${view}`}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={
              reducedMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <CatalogView
              type={view}
              searchQuery={browseQuery}
              access={viewerAccess}
              onSelect={(media) => openMedia(media, "details")}
              onPrimary={(media) => openMedia(media, view === "ANIME" ? "play" : "read")}
            />
          </motion.div>
        ) : viewerAccess.kind === "member" ? (
          <motion.div
            className="profile-route-transition"
            key={`profile-member-${viewerAccess.dashboard.profile.id}`}
            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -10 }}
            transition={
              reducedMotion ? { duration: 0 } : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <ProfileView
              dashboard={viewerAccess.dashboard}
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
              onRefresh={() => viewerSession.refresh()}
              onLogout={() => viewerSession.logout()}
            />
          </motion.div>
        ) : (
          <motion.div
            className="profile-route-transition"
            key="profile-connect"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -12, scale: 0.99 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.26, ease: [0.4, 0, 1, 1] }}
          >
            <ProfileConnectView
              auth={auth}
              restoring={authRestoring}
              error={error}
              onConnect={connect}
              onCancel={cancelConnect}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
              key={mediaDetailInstanceKey(selectedMedia, viewerAccess)}
              media={selectedMedia}
              initialAction={selectedAction}
              onClose={() => {
                setSelectedMedia(undefined);
                setSelectedAction("details");
              }}
              access={viewerAccess}
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
  const reducedMotion = useReducedMotion();
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const activeListName = activeGroupName ?? selectedGroup;
  const profileTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

  const closeAccountMenu = useCallback((): void => {
    accountMenuRef.current?.removeAttribute("open");
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!accountMenuRef.current?.contains(event.target as Node)) closeAccountMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [closeAccountMenu]);

  return (
    <>
      <motion.header
        className="profile-hero"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={profileTransition}
        style={
          dashboard.profile.bannerUrl
            ? {
                backgroundImage: `linear-gradient(90deg, rgb(13 15 18 / .96) 4%, rgb(13 15 18 / .76) 48%, rgb(13 15 18 / .36)), ${safeBackgroundUrl(dashboard.profile.bannerUrl)}`,
              }
            : undefined
        }
      >
        <motion.div
          className="profile-summary"
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={profileTransition}
        >
          <div className="profile-avatar-frame">
            <img
              className="profile-avatar"
              src={dashboard.profile.avatarUrl}
              alt={`${dashboard.profile.name}'s avatar`}
              decoding="async"
            />
          </div>
          <div className="profile-summary-copy">
            <p className="profile-kicker">AniList profile</p>
            <h1>{dashboard.profile.name}</h1>
            {dashboard.profile.about ? (
              <p className="profile-about">{stripMarkup(dashboard.profile.about)}</p>
            ) : null}
          </div>
        </motion.div>

        <motion.div
          className="profile-stats"
          aria-label="AniList statistics"
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reducedMotion ? { duration: 0 } : { ...profileTransition, delay: 0.06 }}
        >
          <ProfileStatGroup
            label="Anime"
            value={dashboard.profile.animeCount}
            details={[
              `${dashboard.profile.episodesWatched.toLocaleString()} episodes`,
              `${formatMinutes(dashboard.profile.minutesWatched)} watched`,
            ]}
          />
          <ProfileStatGroup
            label="Manga"
            value={dashboard.profile.mangaCount}
            details={[
              `${dashboard.profile.chaptersRead.toLocaleString()} chapters`,
              `${dashboard.profile.volumesRead.toLocaleString()} volumes`,
            ]}
          />
        </motion.div>

        <details className="profile-account-menu" ref={accountMenuRef}>
          <summary aria-label="Profile options" title="Profile options">
            <MoreHorizontal size={19} aria-hidden="true" />
          </summary>
          <div role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={syncing}
              onClick={() => {
                closeAccountMenu();
                void onRefresh();
              }}
            >
              <RefreshCw className={syncing ? "spinning" : ""} size={16} aria-hidden="true" />
              {syncing ? "Refreshing" : "Refresh AniList"}
            </button>
            <button
              className="danger"
              type="button"
              role="menuitem"
              onClick={() => {
                closeAccountMenu();
                void onLogout();
              }}
            >
              <LogOut size={16} aria-hidden="true" />
              Log out
            </button>
          </div>
        </details>
      </motion.header>

      <section className="library-shell">
        <div className="library-toolbar">
          <div className="library-primary-controls">
            <div className="media-tabs" role="tablist" aria-label="Library type">
              <button
                className={mediaType === "ANIME" ? "active" : ""}
                type="button"
                role="tab"
                id="profile-anime-tab"
                aria-controls="profile-library-results"
                aria-selected={mediaType === "ANIME"}
                onClick={() => onSwitchType("ANIME")}
              >
                {mediaType === "ANIME" ? (
                  <motion.span
                    className="media-tab-indicator"
                    layoutId="profile-media-tab"
                    transition={profileTransition}
                  />
                ) : null}
                <span>Anime</span>
              </button>
              <button
                className={mediaType === "MANGA" ? "active" : ""}
                type="button"
                role="tab"
                id="profile-manga-tab"
                aria-controls="profile-library-results"
                aria-selected={mediaType === "MANGA"}
                onClick={() => onSwitchType("MANGA")}
              >
                {mediaType === "MANGA" ? (
                  <motion.span
                    className="media-tab-indicator"
                    layoutId="profile-media-tab"
                    transition={profileTransition}
                  />
                ) : null}
                <span>Manga</span>
              </button>
            </div>

            <label className="library-group-select">
              <span>List</span>
              <select
                value={activeListName}
                onChange={(event) => onSelectGroup(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={`${mediaType}-${group.name}`} value={group.name}>
                    {group.name} ({group.entries.length})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="library-secondary-controls">
            <label className="library-search">
              <span className="sr-only">Filter this list</span>
              <Search size={16} aria-hidden="true" />
              <input
                value={listQuery}
                onChange={(event) => onListQuery(event.target.value)}
                placeholder={`Filter ${mediaType === "ANIME" ? "anime" : "manga"}`}
              />
            </label>
            <select
              className="library-sort"
              value={librarySort}
              onChange={(event) => onLibrarySort(event.target.value as LibrarySort)}
              aria-label={`Sort ${mediaType === "ANIME" ? "anime" : "manga"} list`}
            >
              <option value="UPDATED_DESC">Latest updated</option>
              <option value="TITLE_ASC">Title A-Z</option>
              <option value="SCORE_DESC">Highest score</option>
              <option value="PROGRESS_DESC">Most progress</option>
            </select>
            <button className="add-title-button" type="button" onClick={onToggleAdding}>
              {adding ? <X size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
              {adding ? "Close" : "Add title"}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {adding ? (
            <motion.section
              className="catalog-search"
              initial={reducedMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
              transition={profileTransition}
            >
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
            </motion.section>
          ) : null}
        </AnimatePresence>

        {error ? <p className="error-banner">{error}</p> : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="library-results"
            key={`${mediaType}-${activeListName}`}
            id="profile-library-results"
            role="tabpanel"
            aria-labelledby={mediaType === "ANIME" ? "profile-anime-tab" : "profile-manga-tab"}
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={profileTransition}
          >
            <div className="library-heading">
              <div>
                <p className="library-heading-kicker">Your library</p>
                <h2>{activeGroupName ?? (selectedGroup || "No list")}</h2>
              </div>
              <span aria-live="polite">{visibleEntries.length} titles</span>
            </div>
            <div className="media-grid">
              {visibleEntries.map((entry) => (
                <MediaCard
                  entry={entry}
                  key={entry.id}
                  reducedMotion={Boolean(reducedMotion)}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </div>
            {!visibleEntries.length ? (
              <div className="empty-state">
                <h3>Nothing here yet</h3>
                <p>{listQuery ? "Try another filter." : "This AniList group has no titles."}</p>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </section>
    </>
  );
}

function MediaCard({
  entry,
  reducedMotion,
  onSave,
  onDelete,
}: {
  entry: AniListEntry;
  reducedMotion: boolean;
  onSave: (input: UpdateAniListEntryInput) => Promise<void>;
  onDelete: (entry: AniListEntry) => Promise<void>;
}): React.JSX.Element {
  const [status, setStatus] = useState(entry.status);
  const [progress, setProgress] = useState(entry.progress);
  const [score, setScore] = useState(entry.score);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [editing, setEditing] = useState(false);
  const [editorPresent, setEditorPresent] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const progressLabel = entry.media.type === "ANIME" ? "episodes watched" : "chapters read";
  const totalProgress = entry.media.totalProgress;
  const progressRatio = totalProgress ? Math.min(1, entry.progress / totalProgress) : 0;

  const openEditor = useCallback((): void => {
    setStatus(entry.status);
    setProgress(entry.progress);
    setScore(entry.score);
    setNotes(entry.notes ?? "");
    setEditorPresent(true);
    setEditing(true);
  }, [entry.notes, entry.progress, entry.score, entry.status]);

  const closeEditor = useCallback((): void => {
    setEditing(false);
  }, []);

  useEffect(() => {
    if (!editing) return;
    const editButton = editButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKeys = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeEditor();
        return;
      }
      if (event.key !== "Tab" || !editorRef.current) return;
      const focusable = Array.from(
        editorRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKeys);
      editButton?.focus();
    };
  }, [closeEditor, editing]);

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
      closeEditor();
    } finally {
      setSaving(false);
    }
  }

  const editor = (
    <AnimatePresence onExitComplete={() => setEditorPresent(false)}>
      {editing ? (
        <motion.div
          className="entry-editor-backdrop"
          role="presentation"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeEditor();
          }}
        >
          <motion.section
            ref={editorRef}
            className="entry-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`entry-editor-title-${entry.id}`}
            initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.99 }}
            transition={
              reducedMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <header className="entry-editor-header">
              <img src={entry.media.coverUrl} alt="" />
              <div>
                <span>{formatMediaFormat(entry.media.format)}</span>
                <h2 id={`entry-editor-title-${entry.id}`}>{entry.media.title}</h2>
              </div>
              <button type="button" autoFocus aria-label="Close editor" onClick={closeEditor}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="entry-editor-fields">
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
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                />
              </label>
            </div>
            <footer className="editor-actions">
              <button
                className="delete-button"
                type="button"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void onDelete(entry)
                    .then(closeEditor)
                    .finally(() => setSaving(false));
                }}
              >
                Remove
              </button>
              <button
                className="save-button"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return (
    <motion.article
      className="media-card"
      whileHover={
        reducedMotion
          ? undefined
          : { y: -3, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }
      }
      transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
    >
      <div className="cover-wrap">
        <img
          src={entry.media.coverUrl}
          alt={`${entry.media.title} cover`}
          loading="lazy"
          decoding="async"
        />
        <button
          ref={editButtonRef}
          className="media-card-edit"
          type="button"
          disabled={saving}
          aria-label={`Edit ${entry.media.title}`}
          title="Edit entry"
          onClick={openEditor}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
        {!isProgressComplete(entry.status, entry.progress, entry.media.totalProgress) ? (
          <button
            className="progress-button"
            type="button"
            aria-label={`Increase progress for ${entry.media.title}`}
            disabled={saving}
            onClick={() => {
              const next = Math.min(
                entry.media.totalProgress ?? Number.MAX_SAFE_INTEGER,
                entry.progress + 1,
              );
              setSaving(true);
              void onSave({ id: entry.id, progress: next }).finally(() => setSaving(false));
            }}
          >
            +1
          </button>
        ) : null}
      </div>
      <div className="media-card-body">
        <div className="media-card-topline">
          <p className="media-meta">{formatMediaFormat(entry.media.format)}</p>
          <span>{entry.score ? `${entry.score}/10` : "Not rated"}</span>
        </div>
        <h3 title={entry.media.title}>{entry.media.title}</h3>
        <div className="media-card-footer">
          <span>{statusLabel(entry.status)}</span>
          <span>
            {entry.progress}
            {entry.media.totalProgress ? ` / ${entry.media.totalProgress}` : ""} {progressLabel}
          </span>
        </div>
        {totalProgress ? (
          <div className="media-card-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progressRatio})` }} />
          </div>
        ) : null}
      </div>
      {editorPresent ? createPortal(editor, document.body) : null}
    </motion.article>
  );
}

function ProfileStatGroup({
  value,
  label,
  details,
}: {
  value: number;
  label: string;
  details: string[];
}): React.JSX.Element {
  return (
    <div className="profile-stat-group">
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}</strong>
      </div>
      <p>
        {details.map((detail) => (
          <span key={detail}>{detail}</span>
        ))}
      </p>
    </div>
  );
}

function statusLabel(status: AniListEntryStatus): string {
  return ENTRY_STATUSES.find((option) => option.value === status)?.label ?? status;
}

function formatMediaFormat(format?: string): string {
  return formatMediaLabel(format);
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
