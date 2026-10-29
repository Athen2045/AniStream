import { DownloadsProvider } from "./DownloadsProvider";
import { DownloadsView } from "./DownloadsView";
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
  profileRouteVariants,
  routeVariants,
  sectionDirection,
  sectionVariants,
} from "./motion";
import { PersonalLibraryProvider } from "./PersonalLibraryProvider";
import { TitlePageFallback } from "./TitlePageFallback";
import type { ProfileSyncSource } from "./ProfileSyncChip";
import { choosePicture, useProfileLook, useSimklProfile, useSimklStatus } from "./profile-look";
import { EntryEditor } from "./EntryEditor";
import { presetSearchGenre, SectionSearch, type SearchScope } from "./SectionSearch";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useSmoothDocumentScroll } from "./useSmoothDocumentScroll";
import { ReadinessScreen } from "./ReadinessScreen";
import { ContinueUndoToast } from "./ContinueRemoveButton";
import { getAppPreferences } from "./app-preferences";
import { BingeProvider } from "./BingeProvider";
import { bingeAnimeMedia, bingeMoreItem } from "./binge-session";
import type { BingeItem } from "../../shared/binge";
import type { MorePlayTarget } from "./more-format";
import type { SettingsTab } from "./SettingsView";
import { MoreView } from "./MoreView";
import { AppRail, type AppView } from "./AppRail";
import { RouteView } from "./RouteView";
import { useProfileLibrary } from "./useProfileLibrary";
import {
  createLaunchReadiness,
  createProfileReadiness,
  getInactiveReadinessSnapshot,
  subscribeToInactiveReadiness,
} from "./app-readiness";
import { WindowControls } from "./WindowControls";
import type { ReadinessSession } from "./startup-readiness";

// Only needed once a title is opened, never on initial launch -- load it as its own
// chunk instead of paying its parse/compile cost during startup.
const loadMediaDetailModal = () => import("./MediaDetailModal");
const MediaDetailModal = lazy(() =>
  loadMediaDetailModal().then((module) => ({ default: module.MediaDetailModal })),
);
// Views opened from the navbar or account menu, not at launch: each loads as its own chunk.
const ProfileView = lazy(() => import("./ProfileView").then((m) => ({ default: m.ProfileView })));
const SimklProfileView = lazy(() =>
  import("./SimklProfile").then((m) => ({ default: m.SimklProfileView })),
);
const SettingsView = lazy(() =>
  import("./SettingsView").then((m) => ({ default: m.SettingsView })),
);
const ScheduleView = lazy(() =>
  import("./ScheduleView").then((m) => ({ default: m.ScheduleView })),
);
const DownloadedChapterReader = lazy(() =>
  import("./DownloadedChapterReader").then((m) => ({ default: m.DownloadedChapterReader })),
);
const UpNextView = lazy(() => import("./UpNextView").then((m) => ({ default: m.UpNextView })));
/** Once launch settles, the title page's code loads quietly so opening a title never waits on it. */
const MEDIA_DETAIL_PREFETCH_DELAY_MS = 1_500;

const SIMKL_PROFILE_SYNC_AFTER_MS = 30 * 60_000;

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
  const launchReadiness = useMemo(() => createLaunchReadiness(viewerSession), [viewerSession]);
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
  // A downloaded chapter opened from Downloads (read from disk, so offline too).
  const [offlineChapter, setOfflineChapter] = useState<{ aniListId: number; chapterId: string }>();
  const [selectedMore, setSelectedMore] = useState<MoreCatalogItem>();
  const [selectedMoreAction, setSelectedMoreAction] = useState<"details" | "play">("details");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
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
  const library = useProfileLibrary(dashboard);
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

  const direction = sectionDirection(previousView, view);

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
        <DownloadsProvider>
          <main
            className="app-shell"
            inert={activeReadiness ? true : undefined}
            aria-hidden={activeReadiness ? true : undefined}
          >
            <AppRail
              view={view}
              reducedMotion={reducedMotion}
              account={
                viewerAccess.kind === "member"
                  ? {
                      label: viewerAccess.dashboard.profile.name,
                      imageUrl: accountPicture.url,
                      signedIn: true,
                    }
                  : simklAuth
                    ? {
                        label: simklAuth.userName ?? "Simkl",
                        imageUrl: simklAuth.avatarUrl,
                        signedIn: true,
                      }
                    : { label: "Sign in", signedIn: false }
              }
              libraryRefresh={
                viewerAccess.kind === "member"
                  ? { busy: syncing, onRefresh: () => void viewerSession.refresh() }
                  : undefined
              }
              onHome={() => openCatalog("ANIME")}
              onSearch={() => openSearch(true)}
              onCatalog={openCatalog}
              onMore={openMore}
              onSchedule={openSchedule}
              onUpNext={openUpNext}
              onDownloads={openDownloads}
              onProfile={openProfile}
              onSettings={() => openSettings()}
            />
            <WindowControls />
            <UpdateNotice />
            <ContinueUndoToast />

            {/* An open title page covers the route; keep the route out of focus order underneath. */}
            <div className="route-stack" inert={selectedMedia ? true : undefined}>
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                {view === "ANIME" || view === "MANGA" ? (
                  <RouteView
                    key={`catalog-${view}`}
                    variants={sectionVariants}
                    custom={direction}
                    reducedMotion={reducedMotion}
                  >
                    <CatalogView
                      type={view}
                      onLibrary={manageLibrary}
                      access={viewerAccess}
                      onSelect={(media) => openMedia(media, "details")}
                      onPrimary={(media, targetUnit) =>
                        openMedia(media, view === "ANIME" ? "play" : "read", targetUnit)
                      }
                      onBrowseGenre={(genre) => browseGenre(view, genre)}
                    />
                  </RouteView>
                ) : view === "MORE" ? (
                  <RouteView
                    key="more"
                    variants={sectionVariants}
                    custom={direction}
                    reducedMotion={reducedMotion}
                  >
                    <MoreView
                      onBrowseGenre={(genre) => browseGenre("MORE", genre)}
                      viewer={
                        viewerAccess.kind === "member"
                          ? String(viewerAccess.dashboard.profile.id)
                          : "guest"
                      }
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
                  </RouteView>
                ) : view === "SEARCH" ? (
                  <RouteView
                    key="search"
                    variants={profileRouteVariants}
                    reducedMotion={reducedMotion}
                  >
                    <SectionSearch
                      // A new section starts its own search state; the query is carried over.
                      key={searchScope}
                      scope={searchScope}
                      onScopeChange={setSearchScope}
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
                  </RouteView>
                ) : view === "DOWNLOADS" ? (
                  <RouteView key="downloads" variants={routeVariants} reducedMotion={reducedMotion}>
                    <DownloadsView
                      onPlay={(media, episode) => openMedia(media, "play", episode)}
                      onRead={(item) =>
                        setOfflineChapter({ aniListId: item.aniListId, chapterId: item.chapter.id })
                      }
                      onOpenSettings={() => openSettings("playback")}
                    />
                    {offlineChapter ? (
                      <Suspense fallback={null}>
                        <DownloadedChapterReader
                          key={`${offlineChapter.aniListId}:${offlineChapter.chapterId}`}
                          aniListId={offlineChapter.aniListId}
                          chapterId={offlineChapter.chapterId}
                          onClose={() => setOfflineChapter(undefined)}
                        />
                      </Suspense>
                    ) : null}
                  </RouteView>
                ) : view === "UPNEXT" ? (
                  <RouteView key="upnext" variants={routeVariants} reducedMotion={reducedMotion}>
                    <Suspense fallback={null}>
                      <UpNextView />
                    </Suspense>
                  </RouteView>
                ) : view === "SCHEDULE" ? (
                  <RouteView key="schedule" variants={routeVariants} reducedMotion={reducedMotion}>
                    <Suspense fallback={null}>
                      <ScheduleView
                        access={viewerAccess}
                        onOpenMedia={(media) => openMedia(media, "details")}
                        onContinue={(media) =>
                          openMedia(media, media.type === "ANIME" ? "play" : "read")
                        }
                      />
                    </Suspense>
                  </RouteView>
                ) : view === "SETTINGS" ? (
                  <RouteView key="settings" variants={routeVariants} reducedMotion={reducedMotion}>
                    <Suspense fallback={null}>
                      <SettingsView
                        access={viewerAccess}
                        initialTab={settingsTab}
                        onSignIn={openProfile}
                        onOpenProfile={openProfile}
                        onLogout={() => void viewerSession.logout()}
                      />
                    </Suspense>
                  </RouteView>
                ) : viewerAccess.kind === "member" ? (
                  <RouteView
                    key={`profile-member-${viewerAccess.dashboard.profile.id}`}
                    className="profile-route-transition"
                    variants={profileRouteVariants}
                    reducedMotion={reducedMotion}
                    emphasis
                  >
                    <Suspense fallback={null}>
                      <ProfileView
                        dashboard={viewerAccess.dashboard}
                        mediaType={library.mediaType}
                        shelves={library.shelves}
                        activeShelfKey={library.activeShelfKey}
                        formatFilter={library.formatFilter}
                        onFormatFilter={library.setFormatFilter}
                        visibleEntries={library.visibleEntries}
                        listQuery={library.listQuery}
                        librarySort={library.librarySort}
                        adding={library.adding}
                        error={error}
                        onSwitchType={library.switchMediaType}
                        onSelectShelf={library.selectShelf}
                        onListQuery={library.setListQuery}
                        onLibrarySort={library.setLibrarySort}
                        onToggleAdding={library.toggleAdding}
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
                    </Suspense>
                  </RouteView>
                ) : simklStatus && simklAuth ? (
                  <RouteView
                    key="profile-simkl"
                    className="profile-route-transition"
                    variants={profileRouteVariants}
                    reducedMotion={reducedMotion}
                    emphasis
                  >
                    <Suspense fallback={null}>
                      <SimklProfileView
                        profile={simklProfile}
                        status={simklStatus}
                        statsLoading={simklProfileState.statsLoading}
                        syncSources={profileSyncSources}
                        onOpenMore={openMoreFromProfile}
                      />
                    </Suspense>
                  </RouteView>
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
        </DownloadsProvider>
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

  /** A Genre row's View all: Search in that section, filtered to the genre. */
  function browseGenre(scope: SearchScope, genre: string): void {
    presetSearchGenre(scope, genre);
    setSearchScope(scope);
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
    const profileReadiness = createProfileReadiness(viewerSession);
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

  function openDownloads(): void {
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("DOWNLOADS");
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

  function openSettings(tab?: SettingsTab): void {
    setSettingsTab(tab);
    setSelectedMedia(undefined);
    setSelectedMore(undefined);
    setView("SETTINGS");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-settings-heading]")?.focus();
    });
  }
}
