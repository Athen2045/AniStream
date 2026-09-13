import { RefreshCw, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaType,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { CatalogView } from "./CatalogView";
import { GlobalSearch } from "./GlobalSearch";
import { ProfileConnectView } from "./ProfileConnectView";
import { UpdateNotice, UpdateProvider } from "./AppUpdates";
import { mediaDetailInstanceKey } from "./viewer-access";
import { createViewerSession } from "./viewer-session";
import { motionTransition, profileRouteVariants, routeVariants } from "./motion";
import { PersonalLibraryProvider } from "./PersonalLibraryProvider";
import { ReleaseNotifications } from "./ReleaseNotifications";
import { ProfileView, type LibrarySort } from "./ProfileView";
import { EntryEditor } from "./EntryEditor";
import { SearchView } from "./SearchView";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useSmoothDocumentScroll } from "./useSmoothDocumentScroll";
import { ReadinessScreen } from "./ReadinessScreen";
import appIcon from "./assets/app-icon.png";
import {
  createReadinessSession,
  type ReadinessSession,
  type ReadinessSnapshot,
  type ReadinessStageResult,
} from "./startup-readiness";
// Only needed once a title is opened, never on initial launch -- load it as its own
// chunk instead of paying its parse/compile cost during startup.
const MediaDetailModal = lazy(() =>
  import("./MediaDetailModal").then((module) => ({ default: module.MediaDetailModal })),
);

const inactiveReadinessSnapshot: ReadinessSnapshot = {
  attempt: 0,
  mode: "launch",
  progress: 100,
  activeLabel: "AniStream is ready",
  steps: [],
  outcome: "ready",
  canContinue: false,
};
const subscribeToInactiveReadiness = (): (() => void) => () => undefined;
const getInactiveReadinessSnapshot = (): ReadinessSnapshot => inactiveReadinessSnapshot;

export function App(): React.JSX.Element {
  return (
    <UpdateProvider>
      <AppContent />
    </UpdateProvider>
  );
}

function AppContent(): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const cancelSmoothDocumentScroll = useSmoothDocumentScroll();
  const viewerSession = useMemo(() => createViewerSession(window.anistream), []);
  const launchReadiness = useMemo(
    () =>
      createReadinessSession({
        mode: "launch",
        stages: [
          {
            id: "local",
            label: "Opening local data",
            weight: 15,
            required: true,
            failureOutcome: "local-error",
            run: async () => {
              const app = await window.anistream.getAppInfo();
              if (!app.databaseReady) {
                return { status: "local-error" } satisfies ReadinessStageResult;
              }
            },
          },
          {
            id: "session",
            label: "Restoring your saved session",
            weight: 25,
            required: false,
            provider: "AniList",
            failureOutcome: "degraded",
            run: async () => {
              await viewerSession.restore();
              if (viewerSession.getSnapshot().error) {
                return {
                  status: "degraded",
                  provider: "AniList",
                  canContinue: true,
                } satisfies ReadinessStageResult;
              }
            },
          },
          {
            id: "catalog",
            label: "Loading AniList trending titles",
            weight: 40,
            required: true,
            provider: "AniList",
            failureOutcome: "provider-error",
            run: async () => {
              await window.anistream.browseAniList({
                type: "ANIME",
                page: 1,
                perPage: 20,
                sort: "TRENDING_DESC",
              });
            },
          },
          {
            id: "playback",
            label: "Checking anime playback availability",
            weight: 20,
            required: false,
            provider: "Anikoto",
            failureOutcome: "degraded",
            run: async () =>
              normalizePlaybackReadiness(await window.anistream.getAnimeProviderReadiness()),
          },
        ],
      }),
    [viewerSession],
  );
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
  const error = viewerSnapshot.error;
  const [editingEntry, setEditingEntry] = useState<{ entry: AniListEntry; viewerId: number }>();
  const [view, setView] = useState<"ANIME" | "MANGA" | "PROFILE" | "SEARCH">("ANIME");
  const [browseQuery, setBrowseQuery] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<AniListCatalogMedia>();
  const [selectedAction, setSelectedAction] = useState<"details" | "play" | "read">("details");
  const [selectedStartUnit, setSelectedStartUnit] = useState<number>();
  const [mediaType, setMediaType] = useState<AniListMediaType>("ANIME");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("UPDATED_DESC");
  const [adding, setAdding] = useState(false);
  const [libraryRefreshSpinning, setLibraryRefreshSpinning] = useState(false);
  const [activeReadiness, setActiveReadiness] = useState<ReadinessSession | undefined>(
    launchReadiness,
  );
  const readinessSnapshot = useSyncExternalStore(
    activeReadiness?.subscribe ?? subscribeToInactiveReadiness,
    activeReadiness?.getSnapshot ?? getInactiveReadinessSnapshot,
    activeReadiness?.getSnapshot ?? getInactiveReadinessSnapshot,
  );

  useEffect(() => {
    viewerSession.activate();
    void launchReadiness.start();
    return () => {
      launchReadiness.dispose();
      viewerSession.dispose();
    };
  }, [launchReadiness, viewerSession]);

  useEffect(() => {
    if (!activeReadiness || readinessSnapshot.outcome !== "ready") return;
    const destination = readinessSnapshot.mode;
    const completedSession = activeReadiness;
    const dismiss = window.setTimeout(
      () => {
        if (destination === "profile") setView("PROFILE");
        setActiveReadiness((current) => (current === completedSession ? undefined : current));
        if (destination === "profile") {
          window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>("[data-profile-heading]")?.focus();
          });
        }
      },
      reducedMotion ? 0 : 240,
    );
    return () => window.clearTimeout(dismiss);
  }, [activeReadiness, readinessSnapshot.mode, readinessSnapshot.outcome, reducedMotion]);

  useEffect(() => {
    cancelSmoothDocumentScroll();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [browseQuery, cancelSmoothDocumentScroll, view]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (document.querySelector('[aria-modal="true"]')) return;
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
  function switchMediaType(type: AniListMediaType): void {
    setMediaType(type);
    setListQuery("");
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
    if (access.kind !== "member") throw new Error("Connect AniList to manage your library.");
    await access.updateEntry(input);
  }

  async function deleteEntry(entry: AniListEntry): Promise<boolean> {
    if (!window.confirm(`Remove “${entry.media.title}” from your AniList?`)) return false;
    const access = viewerSession.getSnapshot().access;
    if (access.kind !== "member") throw new Error("Connect AniList to manage your library.");
    await access.removeFromLibrary(entry);
    return true;
  }

  async function manageLibrary(media: AniListCatalogMedia): Promise<void> {
    const access = viewerSession.getSnapshot().access;
    if (access.kind !== "member") {
      setSelectedMedia(undefined);
      openProfile();
      return;
    }
    const entry = access.libraryEntries.get(media.id);
    if (entry) setEditingEntry({ entry, viewerId: access.dashboard.profile.id });
    else await access.addToLibrary(media);
  }

  return (
    <PersonalLibraryProvider access={viewerAccess}>
      <>
        <main
          className="app-shell"
          inert={activeReadiness ? true : undefined}
          aria-hidden={activeReadiness ? true : undefined}
        >
          <nav className="app-navbar">
            <button
              className="wordmark"
              type="button"
              aria-label="AniStream home"
              onClick={() => openCatalog("ANIME")}
            >
              <img className="wordmark-logo" src={appIcon} alt="" aria-hidden="true" />
              <span className="wordmark-name">Stream</span>
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
                setSelectedMedia(undefined);
                setBrowseQuery(query);
                setView("SEARCH");
              }}
            />
            <div className="nav-account">
              <ReleaseNotifications onSelect={(media) => openMedia(media, "details")} />
              {viewerAccess.kind === "member" ? (
                <>
                  <button
                    type="button"
                    aria-label="Refresh library"
                    title="Refresh library"
                    disabled={syncing || libraryRefreshSpinning}
                    onClick={() => {
                      if (!reducedMotion) setLibraryRefreshSpinning(true);
                      void viewerSession.refresh();
                    }}
                  >
                    <RefreshCw
                      size={17}
                      className={libraryRefreshSpinning ? "refresh-spin-once" : undefined}
                      aria-hidden="true"
                      onAnimationEnd={() => setLibraryRefreshSpinning(false)}
                    />
                  </button>
                  <button
                    className={`avatar-button ${view === "PROFILE" ? "active" : ""}`}
                    type="button"
                    onClick={openProfile}
                    aria-label="Open profile"
                    title="Open profile"
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
                  onClick={openProfile}
                  aria-label="Open profile and connect AniList"
                  title="Sign in to AniList"
                >
                  <UserRound size={17} />
                  <span>Sign in</span>
                </button>
              )}
            </div>
          </nav>
          <UpdateNotice />

          <AnimatePresence mode="wait" initial={false}>
            {view === "ANIME" || view === "MANGA" ? (
              <motion.div
                className="route-view"
                key={`catalog-${view}`}
                variants={routeVariants}
                initial={reducedMotion ? false : "initial"}
                animate="animate"
                exit={reducedMotion ? undefined : "exit"}
                transition={motionTransition(reducedMotion)}
              >
                <CatalogView
                  type={view}
                  searchQuery=""
                  onLibrary={manageLibrary}
                  access={viewerAccess}
                  onSelect={(media) => openMedia(media, "details")}
                  onPrimary={(media, targetUnit) =>
                    openMedia(media, view === "ANIME" ? "play" : "read", targetUnit)
                  }
                />
              </motion.div>
            ) : view === "SEARCH" ? (
              <motion.div
                key="search"
                className="route-view"
                initial={false}
                animate={{ opacity: 1 }}
              >
                <SearchView
                  key={browseQuery}
                  query={browseQuery}
                  access={viewerAccess}
                  onSelect={(media) => openMedia(media, "details")}
                  onPrimary={(media) => openMedia(media, media.type === "ANIME" ? "play" : "read")}
                  onLibrary={manageLibrary}
                />
              </motion.div>
            ) : viewerAccess.kind === "member" ? (
              <motion.div
                className="profile-route-transition"
                key={`profile-member-${viewerAccess.dashboard.profile.id}`}
                variants={profileRouteVariants}
                initial={reducedMotion ? false : "initial"}
                animate="animate"
                exit={reducedMotion ? undefined : "exit"}
                transition={motionTransition(reducedMotion, "emphasis")}
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
                  syncing={syncing}
                  error={error}
                  onSwitchType={switchMediaType}
                  onSelectGroup={setSelectedGroup}
                  onListQuery={setListQuery}
                  onLibrarySort={setLibrarySort}
                  onToggleAdding={() => setAdding((value) => !value)}
                  onSave={saveEntry}
                  onEdit={(entry) =>
                    setEditingEntry({ entry, viewerId: viewerAccess.dashboard.profile.id })
                  }
                  access={viewerAccess}
                  onLibrary={manageLibrary}
                  onRefresh={() => viewerSession.refresh()}
                  onLogout={() => viewerSession.logout()}
                  onOpenMedia={(media, action) => openMedia({ ...media, genres: [] }, action)}
                />
              </motion.div>
            ) : (
              <motion.div
                className="profile-route-transition"
                key="profile-connect"
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -12, scale: 0.99 }}
                transition={motionTransition(reducedMotion, "standard")}
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
                  initialUnit={selectedStartUnit}
                  onNavigate={(media) => openMedia(media, "details")}
                  onClose={() => {
                    setSelectedMedia(undefined);
                    setSelectedAction("details");
                    setSelectedStartUnit(undefined);
                  }}
                  access={viewerAccess}
                  onLibrary={manageLibrary}
                />
              ) : null}
            </AnimatePresence>
          </Suspense>
          {editingEntry &&
          viewerAccess.kind === "member" &&
          editingEntry.viewerId === viewerAccess.dashboard.profile.id ? (
            <EntryEditor
              key={`${viewerAccess.dashboard.profile.id}:${editingEntry.entry.id}`}
              entry={editingEntry.entry}
              onSave={saveEntry}
              onDelete={deleteEntry}
              onClose={() => setEditingEntry(undefined)}
            />
          ) : null}
        </main>
        <AnimatePresence>
          {activeReadiness ? (
            <ReadinessScreen
              key={`${readinessSnapshot.mode}-${readinessSnapshot.attempt}`}
              snapshot={readinessSnapshot}
              reducedMotion={reducedMotion}
              onRetry={() => void activeReadiness.retry()}
              onContinue={() => activeReadiness.continueDegraded()}
            />
          ) : null}
        </AnimatePresence>
      </>
    </PersonalLibraryProvider>
  );

  function openCatalog(type: "ANIME" | "MANGA"): void {
    setSelectedMedia(undefined);
    setBrowseQuery("");
    setView(type);
  }

  function openMedia(
    media: AniListCatalogMedia,
    action: "details" | "play" | "read",
    startUnit?: number,
  ): void {
    setSelectedAction(action);
    setSelectedStartUnit(startUnit);
    setSelectedMedia(media);
  }

  function openProfile(): void {
    if (view === "PROFILE" && !activeReadiness) return;
    if (activeReadiness?.getSnapshot().mode === "profile") return;
    setSelectedMedia(undefined);
    const profileReadiness = createReadinessSession({
      mode: "profile",
      stages: [
        {
          id: "account",
          label: "Checking your AniList account",
          weight: 30,
          required: true,
          provider: "AniList",
          failureOutcome: "provider-error",
          run: async () => {
            const current = viewerSession.getSnapshot();
            if (current.auth.status === "error") {
              return {
                status: "provider-error",
                provider: "AniList",
                canContinue: true,
              } satisfies ReadinessStageResult;
            }
          },
        },
        {
          id: "saved-profile",
          label: "Preparing your saved profile",
          weight: 30,
          required: false,
          provider: "AniList",
          failureOutcome: "degraded",
          run: async () => {
            const current = viewerSession.getSnapshot();
            if (current.access.kind === "guest" || current.hasVerifiedDashboard) return;
            return {
              status: "disabled",
              message: "No saved profile data is available yet.",
            } satisfies ReadinessStageResult;
          },
        },
        {
          id: "library",
          label: "Updating your AniList library",
          weight: 40,
          required: true,
          provider: "AniList",
          failureOutcome: "provider-error",
          run: async () => {
            if (viewerSession.getSnapshot().access.kind === "guest") return;
            await viewerSession.refresh();
            const current = viewerSession.getSnapshot();
            if (!current.error) return;
            return {
              status: /connection|internet|could not reach/i.test(current.error)
                ? "offline"
                : "provider-error",
              provider: "AniList",
              canContinue: current.hasVerifiedDashboard,
            } satisfies ReadinessStageResult;
          },
        },
      ],
    });
    setActiveReadiness(profileReadiness);
    void profileReadiness.start();
  }
}

function normalizePlaybackReadiness(
  result: Awaited<ReturnType<typeof window.anistream.getAnimeProviderReadiness>>,
): void | ReadinessStageResult {
  if (result.status === "ready") return;
  if (result.status === "disabled") return { status: "disabled", message: result.message };
  if (result.status === "offline") return { status: "offline", provider: "Anikoto" };
  if (result.status === "rate-limited") {
    return {
      status: "degraded",
      provider: "Anikoto",
      message: "Anikoto is busy right now. Please wait a few minutes, then try again.",
      canContinue: true,
    };
  }
  return { status: "degraded", provider: "Anikoto", canContinue: true };
}
