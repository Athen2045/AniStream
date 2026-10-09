import { CalendarDays, ListVideo, RefreshCw, Search } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaType,
  MoreCatalogItem,
  UpdateAniListEntryInput,
} from "../../shared/contracts";
import { CatalogView } from "./CatalogView";
import { ProfileConnectView } from "./ProfileConnectView";
import { UpdateNotice, UpdateProvider } from "./AppUpdates";
import { mediaDetailInstanceKey } from "./viewer-access";
import { createViewerSession } from "./viewer-session";
import {
  motionTransition,
  navIndicatorTransition,
  profileRouteVariants,
  routeVariants,
  sectionDirection,
  sectionVariants,
} from "./motion";
import { PersonalLibraryProvider } from "./PersonalLibraryProvider";
import { ProfileView } from "./ProfileView";
import { SimklProfileView } from "./SimklProfile";
import { TitlePageFallback } from "./TitlePageFallback";
import type { ProfileSyncSource } from "./ProfileSyncChip";
import { choosePicture, useProfileLook, useSimklProfile, useSimklStatus } from "./profile-look";
import {
  buildLibraryShelves,
  defaultShelfKey,
  filterLibrary,
  type LibrarySort,
} from "./profile-library";
import { EntryEditor } from "./EntryEditor";
import { SectionSearch, type SearchScope } from "./SectionSearch";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useSmoothDocumentScroll } from "./useSmoothDocumentScroll";
import { ReadinessScreen } from "./ReadinessScreen";
import { NavbarAccountMenu } from "./NavbarAccountMenu";
import { SettingsView } from "./SettingsView";
import { ContinueUndoToast } from "./ContinueRemoveButton";
import { getAppPreferences, useAppPreferences } from "./app-preferences";
import { ScheduleView } from "./ScheduleView";
import { BingeProvider, useBinge } from "./BingeProvider";
import { UpNextView } from "./UpNextView";
import { bingeAnimeMedia, bingeMoreItem } from "./binge-session";
import type { BingeItem } from "../../shared/binge";
import type { MorePlayTarget } from "./more-format";
import { MoreView } from "./MoreView";
import appIcon from "./assets/app-icon.png";
import {
  createReadinessSession,
  createLaunchCatalogReadinessStage,
  type ReadinessSession,
  type ReadinessSnapshot,
  type ReadinessStageResult,
} from "./startup-readiness";
// Only needed once a title is opened, never on initial launch -- load it as its own
// chunk instead of paying its parse/compile cost during startup.
const loadMediaDetailModal = () => import("./MediaDetailModal");
const MediaDetailModal = lazy(() =>
  loadMediaDetailModal().then((module) => ({ default: module.MediaDetailModal })),
);
/** Once launch settles, the title page's code loads quietly so opening a title never waits on it. */
const MEDIA_DETAIL_PREFETCH_DELAY_MS = 1_500;

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
const SIMKL_PROFILE_SYNC_AFTER_MS = 30 * 60_000;
const getInactiveReadinessSnapshot = (): ReadinessSnapshot => inactiveReadinessSnapshot;
type AppView =
  "ANIME" | "MANGA" | "MORE" | "PROFILE" | "SEARCH" | "SETTINGS" | "SCHEDULE" | "UPNEXT";

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
            shortLabel: "Local data",
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
            shortLabel: "Session",
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
          createLaunchCatalogReadinessStage(async () => {
            await window.anistream.browseAniList({
              type: "ANIME",
              page: 1,
              perPage: 20,
              sort: "TRENDING_DESC",
            });
          }),
          {
            id: "playback",
            label: "Checking anime playback availability",
            shortLabel: "Anime player",
            weight: 20,
            required: false,
            provider: "The anime player",
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
  const simklStatus = useSimklStatus();
  const simklAuth = simklStatus?.auth.status === "connected" ? simklStatus.auth : undefined;
  const simklProfileState = useSimklProfile(simklStatus);
  const simklProfile = simklProfileState.profile;
  const profileLook = useProfileLook();
  const accountPicture = choosePicture(
    profileLook.picture,
    dashboard?.profile.avatarUrl,
    simklAuth?.avatarUrl,
  );
  const authRestoring = viewerSnapshot.restoring;
  const syncing = viewerSnapshot.syncing;
  const error = viewerSnapshot.error;
  // What the Profile status chip shows: each connected account still updating, or failed.
  const profileSyncSources: ProfileSyncSource[] = [
    ...(viewerAccess.kind === "member"
      ? [
          {
            source: "anilist" as const,
            state: syncing ? ("busy" as const) : error ? ("failed" as const) : ("done" as const),
          },
        ]
      : []),
    ...(simklAuth
      ? [
          {
            source: "simkl" as const,
            state:
              simklStatus?.library?.syncing || simklProfileState.loading
                ? ("busy" as const)
                : simklStatus?.library?.error
                  ? ("failed" as const)
                  : ("done" as const),
          },
        ]
      : []),
  ];
  const [editingEntry, setEditingEntry] = useState<{ entry: AniListEntry; viewerId: number }>();
  // The previous view is kept with the current one so section transitions know their direction.
  // The app opens on the section chosen in Settings → Customize.
  const [{ view, from: previousView }, setViewPair] = useState<{ view: AppView; from: AppView }>(
    () => ({ view: getAppPreferences().startSection, from: getAppPreferences().startSection }),
  );
  const preferences = useAppPreferences();
  const setView = useCallback(
    (next: AppView) =>
      setViewPair((current) =>
        current.view === next ? current : { view: next, from: current.view },
      ),
    [],
  );
  const [searchScope, setSearchScope] = useState<SearchScope>(
    () => getAppPreferences().startSection,
  );
  const [selectedMedia, setSelectedMedia] = useState<AniListCatalogMedia>();
  const [selectedMore, setSelectedMore] = useState<MoreCatalogItem>();
  const [selectedMoreAction, setSelectedMoreAction] = useState<"details" | "play">("details");
  const [navbarScrolled, setNavbarScrolled] = useState(false);
  const openMoreDetails = useCallback((item: MoreCatalogItem) => {
    setSelectedMoreAction("details");
    setSelectedMore(item);
  }, []);
  // A queued episode starts at its exact target; otherwise the title page picks the resume point.
  const [selectedMoreStart, setSelectedMoreStart] = useState<MorePlayTarget>();
  // Bumped when Up Next starts an item, so replaying the open title remounts its page and plays.
  const [playNonce, setPlayNonce] = useState(0);
  const openMorePlayback = useCallback((item: MoreCatalogItem, start?: MorePlayTarget) => {
    setSelectedMoreAction("play");
    setSelectedMoreStart(start);
    setSelectedMore(item);
  }, []);
  // A More title opened from Search returns there on Back (Anime/Manga titles already open over
  // the search page; More titles live inside the More section).
  const [moreFromSearch, setMoreFromSearch] = useState(false);
  const closeMoreTitle = useCallback(() => {
    setSelectedMore(undefined);
    setSelectedMoreAction("details");
    if (moreFromSearch) {
      setMoreFromSearch(false);
      setSearchScope("MORE");
      setView("SEARCH");
    }
  }, [moreFromSearch, setView]);
  const [selectedAction, setSelectedAction] = useState<"details" | "play" | "read">("details");
  const [selectedStartUnit, setSelectedStartUnit] = useState<number>();
  const [mediaType, setMediaType] = useState<AniListMediaType>("ANIME");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("UPDATED_DESC");
  const [formatFilter, setFormatFilter] = useState("");
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
    let prefetch: number | undefined;
    void launchReadiness.start().then(() => {
      prefetch = window.setTimeout(
        () => void loadMediaDetailModal().catch(() => undefined),
        MEDIA_DETAIL_PREFETCH_DELAY_MS,
      );
    });
    return () => {
      window.clearTimeout(prefetch);
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
  }, [activeReadiness, readinessSnapshot.mode, readinessSnapshot.outcome, reducedMotion, setView]);

  useEffect(() => {
    cancelSmoothDocumentScroll();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [cancelSmoothDocumentScroll, view]);

  // Catalog navbars float over hero artwork and only gain a surface once content scrolls under it.
  const overlayNavbar =
    view === "MORE" ||
    view === "ANIME" ||
    view === "MANGA" ||
    view === "SEARCH" ||
    view === "PROFILE" ||
    view === "SCHEDULE" ||
    view === "UPNEXT" ||
    view === "SETTINGS";
  const direction = sectionDirection(previousView, view);
  const sectionActive = (section: SearchScope): boolean =>
    view === section || (view === "SEARCH" && searchScope === section);
  useEffect(() => {
    if (!overlayNavbar) return;
    const update = (): void => setNavbarScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [overlayNavbar]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        openSearch(false);
        document.querySelector<HTMLInputElement>(".section-search-field input")?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  });

  const groups = mediaType === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
  // Profile shelves: one per status (AniList's per-format lists merged) plus custom lists.
  const shelves = useMemo(
    () => buildLibraryShelves(groups ?? [], mediaType === "ANIME"),
    [groups, mediaType],
  );
  const activeShelf =
    shelves.find((shelf) => shelf.key === selectedGroup) ??
    shelves.find((shelf) => shelf.key === defaultShelfKey(shelves));
  const visibleEntries = useMemo(
    () =>
      filterLibrary(activeShelf?.entries ?? [], {
        query: listQuery,
        format: formatFilter,
        sort: librarySort,
      }),
    [activeShelf, formatFilter, librarySort, listQuery],
  );
  function switchMediaType(type: AniListMediaType): void {
    setMediaType(type);
    setListQuery("");
    setSelectedGroup("");
    setFormatFilter("");
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
      <BingeProvider onPlay={playBingeItem}>
        <main
          className="app-shell"
          inert={activeReadiness ? true : undefined}
          aria-hidden={activeReadiness ? true : undefined}
        >
          <nav
            className={
              overlayNavbar
                ? `app-navbar app-navbar--overlay${navbarScrolled ? " is-scrolled" : ""}`
                : "app-navbar"
            }
          >
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
                className={sectionActive("ANIME") ? "active" : ""}
                type="button"
                onClick={() => openCatalog("ANIME")}
              >
                Anime
                {sectionActive("ANIME") ? (
                  <motion.span
                    className="nav-underline"
                    layoutId="nav-underline"
                    transition={navIndicatorTransition(reducedMotion)}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
              <button
                className={sectionActive("MANGA") ? "active" : ""}
                type="button"
                onClick={() => openCatalog("MANGA")}
              >
                Manga
                {sectionActive("MANGA") ? (
                  <motion.span
                    className="nav-underline"
                    layoutId="nav-underline"
                    transition={navIndicatorTransition(reducedMotion)}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
              <button
                className={sectionActive("MORE") ? "active" : ""}
                type="button"
                onClick={() => openMore()}
              >
                More
                {sectionActive("MORE") ? (
                  <motion.span
                    className="nav-underline"
                    layoutId="nav-underline"
                    transition={navIndicatorTransition(reducedMotion)}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            </div>
            <span className="nav-spacer" aria-hidden="true" />
            <div className="nav-account">
              <button
                type="button"
                className={`nav-search-button${view === "SEARCH" ? " active" : ""}`}
                aria-label={view === "SEARCH" ? "Close search" : "Search"}
                aria-pressed={view === "SEARCH"}
                title="Search (Ctrl+K)"
                onClick={() => openSearch(true)}
              >
                <Search size={17} aria-hidden="true" />
              </button>
              {preferences.schedule ? (
                <button
                  type="button"
                  className={`nav-schedule-button${view === "SCHEDULE" ? " active" : ""}`}
                  aria-label="Airing schedule"
                  aria-pressed={view === "SCHEDULE"}
                  title="Airing schedule"
                  onClick={openSchedule}
                >
                  <CalendarDays size={17} aria-hidden="true" />
                </button>
              ) : null}
              {preferences.upNext ? (
                <UpNextNavButton active={view === "UPNEXT"} onOpen={openUpNext} />
              ) : null}
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
                  <NavbarAccountMenu
                    kind="member"
                    active={view === "PROFILE" || view === "SETTINGS"}
                    name={viewerAccess.dashboard.profile.name}
                    avatarUrl={accountPicture.url}
                    subtitle={simklAuth ? "AniList + Simkl" : "AniList profile"}
                    onOpenProfile={openProfile}
                    onOpenSettings={openSettings}
                    onLogout={() => void viewerSession.logout()}
                  />
                </>
              ) : simklAuth ? (
                <NavbarAccountMenu
                  kind="member"
                  active={view === "PROFILE" || view === "SETTINGS"}
                  name={simklAuth.userName ?? "Simkl"}
                  avatarUrl={simklAuth.avatarUrl}
                  subtitle="Simkl profile"
                  onOpenProfile={openProfile}
                  onOpenSettings={openSettings}
                  onLogout={() => void window.anistream.disconnectSimkl().catch(() => undefined)}
                />
              ) : (
                <NavbarAccountMenu
                  kind="guest"
                  active={view === "PROFILE" || view === "SETTINGS"}
                  onOpenSettings={openSettings}
                  onSignIn={openProfile}
                />
              )}
            </div>
          </nav>
          <UpdateNotice />
          <ContinueUndoToast />

          {/* An open title page covers the route; keep the route out of focus order underneath. */}
          <div className="route-stack" inert={selectedMedia ? true : undefined}>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              {view === "ANIME" || view === "MANGA" ? (
                <motion.div
                  className="route-view"
                  key={`catalog-${view}`}
                  custom={direction}
                  variants={sectionVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <CatalogView
                    type={view}
                    onLibrary={manageLibrary}
                    access={viewerAccess}
                    onSelect={(media) => openMedia(media, "details")}
                    onPrimary={(media, targetUnit) =>
                      openMedia(media, view === "ANIME" ? "play" : "read", targetUnit)
                    }
                  />
                </motion.div>
              ) : view === "MORE" ? (
                <motion.div
                  className="route-view"
                  key="more"
                  custom={direction}
                  variants={sectionVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <MoreView
                    selection={
                      selectedMore
                        ? {
                            item: selectedMore,
                            action: selectedMoreAction,
                            start: selectedMoreAction === "play" ? selectedMoreStart : undefined,
                            nonce: playNonce,
                            backLabel: moreFromSearch ? "Search" : undefined,
                          }
                        : undefined
                    }
                    onSelect={openMoreDetails}
                    onPrimary={(item) => openMorePlayback(item)}
                    onCloseTitle={closeMoreTitle}
                  />
                </motion.div>
              ) : view === "SEARCH" ? (
                <motion.div
                  className="route-view"
                  key={`search-${searchScope}`}
                  variants={profileRouteVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <SectionSearch
                    scope={searchScope}
                    access={viewerAccess}
                    onOpenMedia={(media) => openMedia(media, "details")}
                    onPrimaryMedia={(media) =>
                      openMedia(media, media.type === "ANIME" ? "play" : "read")
                    }
                    onLibrary={manageLibrary}
                    onOpenMore={(item) => {
                      openMore();
                      setMoreFromSearch(true);
                      openMoreDetails(item);
                    }}
                    onPrimaryMore={(item) => {
                      openMore();
                      setMoreFromSearch(true);
                      openMorePlayback(item);
                    }}
                  />
                </motion.div>
              ) : view === "UPNEXT" ? (
                <motion.div
                  className="route-view"
                  key="upnext"
                  variants={routeVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <UpNextView />
                </motion.div>
              ) : view === "SCHEDULE" ? (
                <motion.div
                  className="route-view"
                  key="schedule"
                  variants={routeVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <ScheduleView
                    access={viewerAccess}
                    onOpenMedia={(media) => openMedia(media, "details")}
                    onContinue={(media) =>
                      openMedia(media, media.type === "ANIME" ? "play" : "read")
                    }
                  />
                </motion.div>
              ) : view === "SETTINGS" ? (
                <motion.div
                  className="route-view"
                  key="settings"
                  variants={routeVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion)}
                >
                  <SettingsView
                    access={viewerAccess}
                    onSignIn={openProfile}
                    onOpenProfile={openProfile}
                    onLogout={() => void viewerSession.logout()}
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
                    shelves={shelves}
                    activeShelfKey={activeShelf?.key ?? ""}
                    formatFilter={formatFilter}
                    onFormatFilter={setFormatFilter}
                    visibleEntries={visibleEntries}
                    listQuery={listQuery}
                    librarySort={librarySort}
                    adding={adding}
                    error={error}
                    onSwitchType={switchMediaType}
                    onSelectShelf={(key) => {
                      setSelectedGroup(key);
                      setFormatFilter("");
                    }}
                    onListQuery={setListQuery}
                    onLibrarySort={setLibrarySort}
                    onToggleAdding={() => setAdding((value) => !value)}
                    onEdit={(entry) =>
                      setEditingEntry({ entry, viewerId: viewerAccess.dashboard.profile.id })
                    }
                    access={viewerAccess}
                    onLibrary={manageLibrary}
                    onOpenMedia={(media, action) => openMedia({ ...media, genres: [] }, action)}
                    simkl={simklProfile}
                    simklStatus={simklStatus}
                    simklStatsLoading={simklProfileState.statsLoading}
                    syncSources={profileSyncSources}
                    onOpenMore={openMoreFromProfile}
                  />
                </motion.div>
              ) : simklStatus && simklAuth ? (
                <motion.div
                  className="profile-route-transition"
                  key="profile-simkl"
                  variants={profileRouteVariants}
                  initial={reducedMotion ? false : "initial"}
                  animate="animate"
                  exit={reducedMotion ? undefined : "exit"}
                  transition={motionTransition(reducedMotion, "emphasis")}
                >
                  <SimklProfileView
                    profile={simklProfile}
                    status={simklStatus}
                    statsLoading={simklProfileState.statsLoading}
                    syncSources={profileSyncSources}
                    onOpenMore={openMoreFromProfile}
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
                    simkl={simklStatus}
                    auth={auth}
                    restoring={authRestoring}
                    error={error}
                    onConnect={connect}
                    onCancel={cancelConnect}
                    onBrowse={openStartSection}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Suspense fallback={selectedMedia ? <TitlePageFallback media={selectedMedia} /> : null}>
            <AnimatePresence mode="wait">
              {selectedMedia ? (
                <MediaDetailModal
                  key={`${mediaDetailInstanceKey(selectedMedia, viewerAccess)}:${playNonce}`}
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
                  onScrolledChange={setNavbarScrolled}
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
      </BingeProvider>
    </PersonalLibraryProvider>
  );

  function openCatalog(type: "ANIME" | "MANGA"): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView(type);
  }

  /** Opens the search page for the current section; `toggle` returns to that section instead. */
  function openSearch(toggle: boolean): void {
    if (view === "SEARCH") {
      if (!toggle) return;
      if (searchScope === "MORE") openMore();
      else openCatalog(searchScope);
      return;
    }
    if (view === "ANIME" || view === "MANGA" || view === "MORE") setSearchScope(view);
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("SEARCH");
  }

  function openStartSection(): void {
    const start = getAppPreferences().startSection;
    if (start === "MORE") openMore();
    else openCatalog(start);
  }

  /** Opening Profile syncs Simkl when its last import is over 30 minutes old. */
  function refreshSimklIfStale(): void {
    const library = simklStatus?.library;
    if (!simklAuth || !library || library.syncing) return;
    const syncedAt = library.syncedAt ? Date.parse(library.syncedAt) : 0;
    if (Date.now() - syncedAt > SIMKL_PROFILE_SYNC_AFTER_MS)
      void window.anistream.syncSimkl().catch(() => undefined);
  }

  function openMoreFromProfile(item: MoreCatalogItem): void {
    openMore();
    openMoreDetails(item);
  }

  function openMore(): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setMoreFromSearch(false);
    setSelectedMoreAction("details");
    setView("MORE");
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
    setSelectedMore(undefined);
    // A saved copy opens at once and updates in place (approved 2026-10-07); the full-screen
    // check stays only for a first load with nothing saved.
    const current = viewerSession.getSnapshot();
    const savedAniList = current.access.kind === "member" && current.hasVerifiedDashboard;
    const simklOnly = current.access.kind === "guest" && Boolean(simklAuth);
    if (savedAniList || simklOnly) {
      cancelSmoothDocumentScroll();
      window.scrollTo({ top: 0, behavior: "instant" });
      setView("PROFILE");
      if (savedAniList) void viewerSession.refresh();
      refreshSimklIfStale();
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("[data-profile-heading]")?.focus();
      });
      return;
    }
    refreshSimklIfStale();
    const profileReadiness = createReadinessSession({
      mode: "profile",
      stages: [
        {
          id: "account",
          label: "Checking your AniList account",
          shortLabel: "Account",
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
          shortLabel: "Saved profile",
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
          shortLabel: "Library",
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

  /** Starts an Up Next or playlist item: anime opens its title page and plays, More likewise. */
  function playBingeItem(item: BingeItem): void {
    setPlayNonce((nonce) => nonce + 1);
    if (item.kind === "anime") {
      setSelectedMore(undefined);
      openMedia(bingeAnimeMedia(item), "play", item.episode);
      return;
    }
    setSelectedMedia(undefined);
    setView("MORE");
    openMorePlayback(
      bingeMoreItem(item),
      item.season && item.episode ? { season: item.season, episode: item.episode } : undefined,
    );
  }

  function openUpNext(): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("UPNEXT");
  }

  function openSchedule(): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("SCHEDULE");
  }

  function openSettings(): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("SETTINGS");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-settings-heading]")?.focus();
    });
  }
}

function normalizePlaybackReadiness(
  result: Awaited<ReturnType<typeof window.anistream.getAnimeProviderReadiness>>,
): void | ReadinessStageResult {
  if (result.status === "ready") return;
  if (result.status === "disabled") return { status: "disabled", message: result.message };
  if (result.status === "offline") return { status: "offline", provider: "The anime player" };
  if (result.status === "rate-limited") {
    return {
      status: "degraded",
      provider: "The anime player",
      message: "The anime player is busy right now. Please wait a few minutes, then try again.",
      canContinue: true,
    };
  }
  return { status: "degraded", provider: "The anime player", canContinue: true };
}

/** Navbar entry to Up Next, with the queue length as a badge. */
function UpNextNavButton({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const { state } = useBinge();
  const count = state.queue.length;
  return (
    <button
      type="button"
      className={`nav-upnext-button${active ? " active" : ""}`}
      aria-label={count ? `Up Next, ${count} queued` : "Up Next"}
      aria-pressed={active}
      title="Up Next and playlists"
      onClick={onOpen}
    >
      <ListVideo size={17} aria-hidden="true" />
      {count ? <span className="nav-badge">{count > 99 ? "99+" : count}</span> : null}
    </button>
  );
}
