import { AnimatePresence, motion } from "framer-motion";
import { PlayerStarting } from "./PlayerStarting";
import { OwnAnimePlayer } from "./player/OwnAnimePlayer";
import { ArrowLeft, Check, ChevronDown, Clock3, LoaderCircle, Play } from "lucide-react";
import { createPortal } from "react-dom";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { getAppPreferences, preferredAudioSource } from "./app-preferences";
import { useAppReducedMotion } from "./useAppReducedMotion";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeArt,
  AnimeEpisodeCatalog,
  AnimeEpisodeRange,
  AnimeEpisodeRanges,
  AnimePlaybackCandidate,
  AnimeProviderEpisode,
  AnimeProviderSeason,
  PlaybackResume,
} from "../../shared/contracts";
import { chooseInitialAnimeEpisode, createAnimePlaybackSession } from "./anime-playback-session";
import { saveAnimeActivity } from "./local-activity";
import {
  airedEpisodeCount,
  episodeAiringLabel,
  episodeRangesLabel,
  missingAiredEpisodes,
  unairedEpisode,
} from "./airing";
import { AutoplayNext, useNextUp } from "./AutoplayNext";
import { EpisodeQueueToggle } from "./UpNextButton";
import { EpisodeDownloadToggle } from "./DownloadButtons";
import { useOptionalDownloads } from "./DownloadsProvider";
import { useOnline } from "./useOnline";
import { cachedArtworkUrl } from "../../shared/artwork";
import { downloadKey } from "../../shared/downloads";
import { animeBingeItem } from "./binge-session";
import { formatMediaLabel } from "./format-label";
import { motionTransition } from "./motion";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";
import { useCaptionControlsVisibility } from "./useCaptionControlsVisibility";
import { friendlyPlaybackError, friendlyRemoteError } from "./remote-error";
import {
  buildAnimeSeries,
  createSeriesLoader,
  inferMediaDisplayedPartNumber,
  inferMediaDisplayedSeasonNumber,
  isSeasonEntry,
  type AnimeSeasonChoice,
  type AnimeSeries,
} from "./anime-season-chain";
import { playStarted } from "./play-timer";

const EPISODES_PAGE_SIZE = 12;
/** Matches the main process: shorter entries are never split into arcs or seasons. */
const MIN_RANGE_EPISODES = 50;

type WatchView = "episodes" | "player";

/** How long a recommendation card waits for AniList's details before loading episodes anyway. */
const THIN_MEDIA_WAIT_MS = 4_000;

export function AnimeWatchExperience({
  media,
  initialEpisode,
  exactEpisode = false,
  autoPlayRequest = 0,
  onEpisodeWatched,
  onNavigate,
  hideEpisodes = false,
  onLeave,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  initialEpisode: number;
  /** Movies: no episode list on the page; the player still opens from the title's Play. */
  hideEpisodes?: boolean;
  /** `initialEpisode` was chosen explicitly, so progress must not move it forward. */
  exactEpisode?: boolean;
  autoPlayRequest?: number;
  onEpisodeWatched: (episode: number) => Promise<void>;
  onNavigate?: (media: AniListCatalogMedia) => void;
  /** Back from a player a Play shortcut opened returns to where it was clicked, not this page. */
  onLeave?: () => void;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const { fullscreen, exitFullscreen, isFullscreenEscape } = useMediaFullscreen(rootRef);
  const episodeFocus = useRef<HTMLElement | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useAppReducedMotion();
  const transitionCommitted = useRef(false);
  const handledAutoPlayRequest = useRef(0);
  const leaveOnBack = useRef(false);
  const pendingEpisodeRef = useRef<AnimeProviderEpisode | null>(null);
  const [catalog, setCatalog] = useState<AnimeEpisodeCatalog>();
  const [activeEpisode, setActiveEpisode] = useState<AnimeProviderEpisode>(() =>
    episodePlaceholder(initialEpisode),
  );
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [view, setView] = useState<WatchView>("episodes");
  const [source, setSource] = useState<AnimePlaybackCandidate>();
  const [resume, setResume] = useState<PlaybackResume>();
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState<string>();
  const [transitionTarget, setTransitionTarget] = useState<WatchView>();
  const [retryCount, setRetryCount] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [catalogMedia, setCatalogMedia] = useState(media);
  // A recommendation card (For You, "Because you…") opens the page before AniList's details arrive
  // and carries no episode count, status or airing schedule. Once they arrive, reload the episode
  // list with them; other updates (e.g. list progress) keep the loaded list.
  if (
    media.id === catalogMedia.id &&
    (media.totalProgress !== catalogMedia.totalProgress ||
      media.status !== catalogMedia.status ||
      media.nextAiringEpisode?.episode !== catalogMedia.nextAiringEpisode?.episode)
  )
    setCatalogMedia(media);
  const [catalogInitialEpisode] = useState(initialEpisode);
  const [catalogExactEpisode] = useState(exactEpisode);
  const [resolvedSeasonNumber, setResolvedSeasonNumber] = useState<number>();
  const displayedSeasonNumber = resolvedSeasonNumber ?? inferMediaDisplayedSeasonNumber(media) ?? 1;
  const {
    visible: playerControlsVisible,
    reveal: revealPlayerControls,
    setPinned: setPlayerControlsPinned,
  } = useAutoHideMediaControls();
  // Windowed, the controls live in their own strip above the video and stay visible; only
  // display fullscreen hides them while idle.
  const playerChromeShown = playerControlsVisible || !source || !fullscreen;
  useCaptionControlsVisibility(view === "player", playerChromeShown);

  const titles = useMemo(() => {
    const detailTitles =
      "synonyms" in catalogMedia
        ? [
            catalogMedia.title,
            catalogMedia.titleEnglish,
            catalogMedia.titleRomaji,
            catalogMedia.titleNative,
            ...catalogMedia.synonyms,
          ]
        : [catalogMedia.title];
    return [...new Set(detailTitles.filter(isNonEmptyString))].slice(0, 8);
  }, [catalogMedia]);

  const fallback = useMemo(() => fallbackSeason(catalogMedia), [catalogMedia]);
  // Episode-art sources (exact links): a still replaces the tile artwork, and a real title and
  // synopsis fill in where the episode list has only "Episode N".
  const [episodeArt, setEpisodeArt] = useState<ReadonlyMap<number, AnimeEpisodeArt>>(new Map());
  const listedSeasons = catalog?.seasons.length ? catalog.seasons : [fallback];
  const lastEpisode = Math.max(
    0,
    ...listedSeasons.flatMap((season) => season.episodes.map((episode) => episode.number)),
  );
  const seasons = useMemo(() => {
    const listed = catalog?.seasons.length ? catalog.seasons : [fallback];
    const withArt = episodeArt.size
      ? listed.map((season) => ({
          ...season,
          episodes: season.episodes.map((episode) => {
            const extra = episodeArt.get(episode.number);
            return extra ? withEpisodeArt(episode, extra) : episode;
          }),
        }))
      : listed;
    return withNextAiringTile(withArt, media);
  }, [catalog, episodeArt, fallback, media]);
  const activeSeason =
    seasons.find((season) => season.id === selectedSeasonId) ??
    seasonContainingEpisode(seasons, activeEpisode) ??
    seasons[0];
  const allEpisodes = useMemo(() => seasons.flatMap((season) => season.episodes), [seasons]);
  // Long runners listed as one season are browsed by story arc (or TheTVDB season).
  // Both are keyed, so a different title or a newly played episode simply stops matching.
  const rangesKey = `${catalogMedia.id}:${lastEpisode}`;
  const [loadedRanges, setLoadedRanges] = useState<{ key: string; ranges?: AnimeEpisodeRanges }>();
  const [rangeChoice, setRangeChoice] = useState<{ episode: number; start: number }>();
  const singleListedSeason = listedSeasons.length === 1;
  useEffect(() => {
    if (loadingCatalog || !singleListedSeason || lastEpisode < MIN_RANGE_EPISODES) return;
    let active = true;
    window.anistream
      .getAnimeEpisodeRanges({ aniListId: catalogMedia.id, episodes: lastEpisode })
      .then((ranges) => {
        if (active) setLoadedRanges({ key: `${catalogMedia.id}:${lastEpisode}`, ranges });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalogMedia.id, lastEpisode, loadingCatalog, singleListedSeason]);
  const episodeRanges =
    singleListedSeason && loadedRanges?.key === rangesKey ? loadedRanges.ranges : undefined;
  // Playing another episode brings the list back to the range that holds it.
  const selectedRangeStart =
    rangeChoice?.episode === activeEpisode.number ? rangeChoice.start : undefined;
  const setSelectedRangeStart = (start: number): void =>
    setRangeChoice({ episode: activeEpisode.number, start });
  const activeRange = episodeRanges
    ? (episodeRanges.ranges.find((range) => range.start === selectedRangeStart) ??
      rangeContaining(episodeRanges.ranges, activeEpisode.number))
    : undefined;
  // Stills follow the episodes on screen: long series load the art around this tab or range.
  const artFocus = activeRange?.start ?? activeSeason?.episodes[0]?.number ?? catalogInitialEpisode;
  useEffect(() => {
    if (loadingCatalog || lastEpisode < 1) return;
    let active = true;
    window.anistream
      .getAnimeEpisodeArt({
        aniListId: catalogMedia.id,
        episodes: lastEpisode,
        focus: Math.min(lastEpisode, Math.max(1, artFocus)),
      })
      .then((art) => {
        if (active && art.length)
          setEpisodeArt(
            (known) => new Map([...known, ...art.map((row) => [row.number, row] as const)]),
          );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artFocus, catalogMedia.id, lastEpisode, loadingCatalog]);
  const activeIndex = useMemo(
    () => allEpisodes.findIndex((episode) => sameEpisode(episode, activeEpisode)),
    [allEpisodes, activeEpisode],
  );
  const nextEpisode = useMemo(() => {
    const next =
      activeIndex >= 0 && activeIndex + 1 < allEpisodes.length
        ? allEpisodes[activeIndex + 1]
        : undefined;
    // The end-of-episode prompt never offers an episode that has not aired yet.
    return next && !unairedEpisode(media, next.number) ? next : undefined;
  }, [activeIndex, allEpisodes, media]);
  const previousEpisode = activeIndex > 0 ? allEpisodes[activeIndex - 1] : undefined;
  // The own player (backup, trial 2026-10-18) takes over for an episode when the main player has
  // no source or reports an error; there is no manual switch in the player (user decision
  // 2026-10-20: audio comes from Settings, the backup is automatic).
  const [backupEpisode, setBackupEpisode] = useState<number>();
  const usingBackup = backupEpisode === activeEpisode.number;
  // A downloaded episode plays from the downloads folder in the own player (works offline).
  const downloads = useOptionalDownloads();
  const downloadedEpisode =
    downloads?.byEpisode.get(downloadKey(media.id, activeEpisode.number))?.status === "done";
  const watchedEpisodes = "listEntry" in media ? (media.listEntry?.progress ?? 0) : 0;

  useEffect(() => playStarted("ANIME"), []);

  // A thin card waits briefly for AniList's details before asking for episodes, so the list does
  // not first appear with a single episode; without details (e.g. offline) it goes ahead anyway.
  const thinMedia = catalogMedia.status === undefined && catalogMedia.totalProgress === undefined;
  const [thinWaitOver, setThinWaitOver] = useState(false);
  useEffect(() => {
    if (!thinMedia) return;
    const timer = window.setTimeout(() => setThinWaitOver(true), THIN_MEDIA_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [thinMedia]);
  const waitForDetails = thinMedia && !thinWaitOver;

  useEffect(() => {
    if (waitForDetails) return;
    let active = true;
    void Promise.allSettled([
      window.anistream.getAnimeEpisodeCatalog({
        aniListId: catalogMedia.id,
        titles,
        seasonLabel:
          catalogMedia.season && catalogMedia.seasonYear
            ? `${formatLabel(catalogMedia.season)} ${catalogMedia.seasonYear}`
            : "Season 1",
        totalEpisodes: Math.max(
          catalogMedia.totalProgress ?? 0,
          catalogMedia.nextAiringEpisode ? catalogMedia.nextAiringEpisode.episode - 1 : 0,
          catalogInitialEpisode,
        ),
      }),
      window.anistream.getPlaybackResume(catalogMedia.id),
      window.anistream.getLocalActivity(),
    ]).then(([catalogResult, resumeResult, activityResult]) => {
      if (!active) return;

      const nextCatalog =
        catalogResult.status === "fulfilled"
          ? catalogResult.value
          : {
              status: "unavailable" as const,
              provider: "anime-source" as const,
              seasons: [],
              message: friendlyRemoteError(catalogResult.reason, {
                provider: "The anime player",
                operation: "episode details",
                fallback:
                  "Episode details could not be loaded. You can still try an episode, or retry the list.",
              }),
              checkedAt: new Date().toISOString(),
            };
      const saved = resumeResult.status === "fulfilled" ? resumeResult.value : undefined;
      const completed =
        activityResult.status === "fulfilled"
          ? Math.max(
              0,
              ...activityResult.value
                .filter((item) => item.media.id === catalogMedia.id)
                .map((item) => item.completedProgress),
            )
          : 0;
      const wantedEpisode = chooseInitialAnimeEpisode({
        requestedEpisode: catalogInitialEpisode,
        savedEpisode: saved?.episode,
        completedProgress: completed,
        totalEpisodes: catalogMedia.totalProgress,
        exact: catalogExactEpisode,
      });
      const usableResume = saved?.episode === wantedEpisode ? saved : undefined;
      const nextSeasons = nextCatalog.seasons.length ? nextCatalog.seasons : [fallback];
      const providerEpisode =
        nextSeasons
          .flatMap((season) => season.episodes)
          .find((episode) => episode.number === wantedEpisode) ?? episodePlaceholder(wantedEpisode);
      const providerSeason =
        seasonContainingEpisode(nextSeasons, providerEpisode) ?? nextSeasons[0];

      setCatalog(nextCatalog);
      setResume(usableResume);
      setActiveEpisode(providerEpisode);
      setSelectedSeasonId(providerSeason?.id ?? "");
      setLoadingCatalog(false);
    });

    return () => {
      active = false;
    };
  }, [
    catalogAttempt,
    fallback,
    catalogExactEpisode,
    catalogInitialEpisode,
    catalogMedia,
    titles,
    waitForDetails,
  ]);

  useEffect(() => {
    if (view !== "player") return;
    // A downloaded episode plays from disk; the main player is not asked at all.
    if (downloadedEpisode) return;
    let active = true;

    void window.anistream
      .getAnimePlayback({
        aniListId: media.id,
        title: media.title,
        episode: activeEpisode.number,
        providerEpisodeId: activeEpisode.id || undefined,
      })
      .then((result) => {
        if (!active) return;
        // Start on the audio chosen in Settings when the episode offers it.
        setSource(
          preferredAudioSource(
            result.candidates.filter((candidate) => candidate.kind === "embed"),
            getAppPreferences().audio,
          ),
        );
        setError(
          result.candidates.some((candidate) => candidate.kind === "embed")
            ? undefined
            : friendlyPlaybackError(result.message),
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(friendlyPlaybackError(reason));
      })
      .finally(() => {
        if (active) setLoadingPlayback(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeEpisode.id,
    activeEpisode.number,
    downloadedEpisode,
    media.id,
    media.title,
    playbackAttempt,
    view,
  ]);

  const commitPendingEpisode = useCallback((): void => {
    const pending = pendingEpisodeRef.current;
    if (pending) {
      pendingEpisodeRef.current = null;
      setActiveEpisode(pending);
    }
  }, []);

  const transitionTo = useCallback(
    (target: WatchView): void => {
      if (transitionTarget) return;
      if (target === view) {
        // Already on the target view (e.g. selecting the next episode while still in the
        // player) — there's no curtain animation to defer behind, so apply immediately.
        commitPendingEpisode();
        return;
      }
      if (reducedMotion) {
        commitPendingEpisode();
        setView(target);
        return;
      }
      transitionCommitted.current = false;
      setTransitionTarget(target);
    },
    [commitPendingEpisode, reducedMotion, transitionTarget, view],
  );

  const playEpisode = useCallback(
    (episode: AnimeProviderEpisode): void => {
      // Unaired episodes are blocked; their tiles show when they air instead.
      if (unairedEpisode(media, episode.number)) return;
      if (view !== "player" && document.activeElement instanceof HTMLElement)
        episodeFocus.current = document.activeElement;
      setResume((current) => (current?.episode === episode.number ? current : undefined));
      setLoadingPlayback(true);
      setSource(undefined);
      setError(undefined);
      setSelectedSeasonId(seasonContainingEpisode(seasons, episode)?.id ?? selectedSeasonId);
      // Defer setActiveEpisode (which triggers the getAnimePlayback IPC/data-fetch effect)
      // until the curtain transition's onAnimationComplete fires, so the IPC round trip
      // doesn't compete with the in-flight 300ms curtain animation for frames.
      pendingEpisodeRef.current = episode;
      transitionTo("player");
    },
    [media, seasons, selectedSeasonId, transitionTo, view],
  );

  useEffect(() => {
    if (
      loadingCatalog ||
      autoPlayRequest <= 0 ||
      handledAutoPlayRequest.current >= autoPlayRequest
    ) {
      return;
    }
    handledAutoPlayRequest.current = autoPlayRequest;
    leaveOnBack.current = Boolean(onLeave);
    playEpisode(activeEpisode);
  }, [activeEpisode, autoPlayRequest, loadingCatalog, onLeave, playEpisode]);

  const returnToEpisodes = useCallback((): void => {
    void exitFullscreen()
      .catch(() => undefined)
      .then(() => {
        if (leaveOnBack.current && onLeave) onLeave();
        else transitionTo("episodes");
      });
  }, [exitFullscreen, onLeave, transitionTo]);

  useEffect(() => {
    if (view !== "player") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        if (!isFullscreenEscape()) returnToEpisodes();
      }
      if (event.key === "Tab") {
        revealPlayerControls();
        const controls = [
          ...(rootRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), select:not(:disabled), iframe",
          ) ?? []),
        ].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [returnToEpisodes, view, isFullscreenEscape, revealPlayerControls]);

  useEffect(() => {
    if (view === "player") {
      backButtonRef.current?.focus();
      // Initial focus makes the back action available to assistive technology, but it
      // must not pin the chrome forever before the viewer interacts with it.
      setPlayerControlsPinned(false);
    } else if (episodeFocus.current?.isConnected)
      episodeFocus.current.focus({ preventScroll: true });
  }, [setPlayerControlsPinned, view]);

  useEffect(() => {
    if (view === "player") revealPlayerControls();
  }, [revealPlayerControls, source?.id, view]);

  const content = (
    <section
      ref={rootRef}
      className={`watch-experience watch-experience--${view}`}
      aria-label={`${media.title} episodes and player`}
    >
      {view === "episodes" ? (
        hideEpisodes ? null : (
          <EpisodeBrowser
            key={activeSeason?.id ?? media.id}
            media={media}
            activeSeason={activeSeason}
            ranges={episodeRanges}
            activeRange={activeRange}
            onSelectRange={(range) => setSelectedRangeStart(range.start)}
            displayedSeasonNumber={displayedSeasonNumber}
            activeEpisode={activeEpisode}
            resume={resume}
            watchedEpisodes={watchedEpisodes}
            loading={loadingCatalog}
            providerMessage={catalog?.message}
            onRetry={() => {
              setLoadingCatalog(true);
              setCatalogAttempt((attempt) => attempt + 1);
            }}
            onNavigate={onNavigate}
            onSeasonNumberResolved={setResolvedSeasonNumber}
            onPlay={(episode) => {
              leaveOnBack.current = false;
              playEpisode(episode);
            }}
          />
        )
      ) : (
        <div
          className="watch-player-view"
          role="dialog"
          aria-modal="true"
          aria-label={`${media.title} player`}
          onPointerMove={(event) => {
            if (event.clientY - event.currentTarget.getBoundingClientRect().top <= 120)
              revealPlayerControls();
          }}
          onPointerDownCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            if (!event.target.closest(".media-control-layer")) setPlayerControlsPinned(false);
          }}
        >
          <div
            className="media-control-reveal-zone"
            aria-hidden="true"
            onPointerMove={revealPlayerControls}
          />
          {/* Hidden controls keep their footprint hoverable so they reappear where the pointer is. */}
          <div
            className="media-control-hotspot media-control-hotspot--back"
            aria-hidden="true"
            onPointerMove={revealPlayerControls}
          />
          <div
            className="media-control-layer media-control-layer--player"
            data-visible={playerChromeShown}
            aria-hidden={!playerChromeShown}
            inert={playerChromeShown ? undefined : true}
            onFocusCapture={() => setPlayerControlsPinned(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setPlayerControlsPinned(false);
            }}
          >
            {/* Window drag area between the controls; display fullscreen has no window to drag. */}
            {!fullscreen ? <div className="player-drag-strip" aria-hidden="true" /> : null}
            <button
              ref={backButtonRef}
              type="button"
              className="watch-player-back"
              aria-label="Back"
              title="Back (Esc)"
              onClick={returnToEpisodes}
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          </div>

          {usingBackup || downloadedEpisode || (!source && !loadingPlayback) ? (
            <OwnAnimePlayer
              key={`own:${activeEpisode.number}`}
              media={catalogMedia}
              title={media.title}
              // The list's copy carries the episode's name (from the art sources) for the title.
              episode={
                activeSeason?.episodes.find((item) => item.number === activeEpisode.number) ??
                activeEpisode
              }
              previousEpisode={previousEpisode}
              nextEpisode={nextEpisode}
              resumeAt={
                resume?.episode === activeEpisode.number ? resume.positionSeconds : undefined
              }
              onNext={playEpisode}
              onPrevious={playEpisode}
              onWatched={onEpisodeWatched}
              onUseMainPlayer={source ? () => setBackupEpisode(undefined) : undefined}
            />
          ) : source ? (
            <AnimeEmbedPlayer
              key={`${activeEpisode.number}:${source.id}:${retryCount}`}
              mediaId={media.id}
              media={catalogMedia}
              title={media.title}
              episode={activeEpisode}
              source={source}
              nextEpisode={nextEpisode}
              onNext={playEpisode}
              onWatched={onEpisodeWatched}
              onRetry={() => {
                setError(undefined);
                setRetryCount((count) => count + 1);
              }}
              onUseBackup={() => setBackupEpisode(activeEpisode.number)}
            />
          ) : (
            <div className="player-unavailable" role="status">
              <Play size={54} />
              <h3>{loadingPlayback ? "Opening the player…" : "Player unavailable"}</h3>
              <p>
                {loadingPlayback
                  ? "Preparing the episode player."
                  : (error ??
                    "This episode is unavailable from the player right now. Try another episode.")}
              </p>
              {!loadingPlayback ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setLoadingPlayback(true);
                    setSource(undefined);
                    setPlaybackAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry episode
                </button>
              ) : null}
            </div>
          )}

          {error && source ? (
            <p className="watch-player-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
      <AnimatePresence
        initial={false}
        onExitComplete={() => {
          transitionCommitted.current = false;
        }}
      >
        {transitionTarget ? (
          <motion.div
            key={`watch-transition-${transitionTarget}`}
            className="watch-view-transition"
            aria-hidden="true"
            initial={{ y: "100%" }}
            animate={{ y: "0%" }}
            exit={{ y: "-100%" }}
            transition={motionTransition(reducedMotion, "emphasis")}
            onAnimationComplete={() => {
              if (transitionCommitted.current) return;
              transitionCommitted.current = true;
              commitPendingEpisode();
              setView(transitionTarget);
              setTransitionTarget(undefined);
            }}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
  return view === "player" ? createPortal(content, document.body) : content;
}

function EpisodeBrowser({
  media,
  activeSeason,
  ranges,
  activeRange,
  onSelectRange,
  displayedSeasonNumber,
  activeEpisode,
  resume,
  watchedEpisodes,
  loading,
  providerMessage,
  onRetry,
  onNavigate,
  onSeasonNumberResolved,
  onPlay,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  activeSeason?: AnimeProviderSeason;
  ranges?: AnimeEpisodeRanges;
  activeRange?: AnimeEpisodeRange;
  onSelectRange: (range: AnimeEpisodeRange) => void;
  displayedSeasonNumber: number;
  activeEpisode: AnimeProviderEpisode;
  resume?: PlaybackResume;
  watchedEpisodes: number;
  loading: boolean;
  providerMessage?: string;
  onRetry: () => void;
  onNavigate?: (media: AniListCatalogMedia) => void;
  onSeasonNumberResolved: (number: number) => void;
  onPlay: (episode: AnimeProviderEpisode) => void;
}): React.JSX.Element {
  const runtime = "duration" in media ? media.duration : undefined;
  const online = useOnline();
  const downloads = useOptionalDownloads();
  // Arcs replace seasons only for a long runner AniList lists without other seasons (the season
  // box decides once the series is known).
  const [arcMode, setArcMode] = useState(false);
  const shownRange = arcMode ? activeRange : undefined;
  // "Show all" belongs to the range it was opened in.
  const [expandedRange, setExpandedRange] = useState<number>();
  const expanded = expandedRange === (shownRange?.start ?? 0);
  const setExpanded = (update: (value: boolean) => boolean): void =>
    setExpandedRange(update(expanded) ? (shownRange?.start ?? 0) : undefined);
  const seasonEpisodes = activeSeason?.episodes ?? [];
  // Aired episodes the source has not added yet are named, not shown as tiles that cannot play.
  const aired = airedEpisodeCount(media);
  const missing = activeSeason?.id.startsWith("index:")
    ? missingAiredEpisodes(
        seasonEpisodes.map((episode) => episode.number),
        aired,
      )
    : [];
  const lastRange = ranges?.ranges.at(-1);
  // The last range also holds the locked next-airing tile past the aired count.
  const episodes = shownRange
    ? seasonEpisodes.filter(
        (episode) =>
          episode.number >= shownRange.start &&
          (shownRange === lastRange || episode.number <= shownRange.end),
      )
    : seasonEpisodes;
  // Collapsed, show the page of episodes holding the current one (episode 112 of 366 opens on
  // 109–120), not always the first page.
  const currentIndex = Math.max(
    0,
    episodes.findIndex((episode) => sameEpisode(episode, activeEpisode)),
  );
  const pageStart = Math.floor(currentIndex / EPISODES_PAGE_SIZE) * EPISODES_PAGE_SIZE;
  const visibleEpisodes = expanded
    ? episodes
    : episodes.slice(pageStart, pageStart + EPISODES_PAGE_SIZE);

  return (
    <div className="netflix-episode-browser">
      <header className="episode-browser-heading">
        <h2>
          Episodes
          <small>
            {shownRange
              ? `${shownRange.title} · Episodes ${shownRange.start}–${shownRange.end}`
              : `${isSeasonEntry(media) ? `Season ${displayedSeasonNumber}` : mediaFormatLabel(media.format)}${missing.length && aired ? ` · ${aired - missing.length} of ${aired} aired` : episodes.length > 1 ? ` · ${episodes.length} episodes` : ""}`}
          </small>
        </h2>
        <SeasonPicker
          media={media}
          onNavigate={onNavigate}
          onCurrentNumber={onSeasonNumberResolved}
          ranges={ranges}
          activeRange={activeRange}
          onSelectRange={onSelectRange}
          onArcModeChange={setArcMode}
        />
      </header>

      {loading ? <p className="catalog-loading">Loading episode details…</p> : null}
      {!loading && missing.length ? (
        <p className="provider-note" role="status">
          {missing.length > 1
            ? `Episodes ${episodeRangesLabel(missing)} have aired, but the source hasn't added them yet.`
            : `Episode ${missing[0]} has aired, but the source hasn't added it yet.`}
        </p>
      ) : null}
      {providerMessage ? (
        <div className="provider-note provider-note--action" role="status">
          <span>{providerMessage}</span>
          <button type="button" onClick={onRetry} disabled={loading}>
            Retry episodes
          </button>
        </div>
      ) : null}

      <div className="episode-grid">
        {visibleEpisodes.map((episode, index) => {
          const isCurrent = sameEpisode(episode, activeEpisode);
          const upcoming = unairedEpisode(media, episode.number);
          // Offline, only downloaded episodes can play; the rest say so instead of failing.
          const needsInternet =
            !online &&
            !upcoming &&
            downloads?.byEpisode.get(downloadKey(media.id, episode.number))?.status !== "done";
          const isWatched = !upcoming && episode.number <= watchedEpisodes;
          const defaultTitle = `Episode ${episode.number}`;
          const episodeTitle = episode.title?.trim();
          // Most episodes have no still: a slice of the series art sits behind the episode number.
          // Through the artwork cache, so it still shows offline once seen.
          const seriesArt = cachedArtworkUrl(media.bannerUrl ?? media.coverUrl);
          const duration = episode.durationMinutes ?? runtime ?? 24;
          const resumed =
            resume?.episode === episode.number && resume.durationSeconds > 0 ? resume : undefined;
          const progress = resumed
            ? Math.min(100, (resumed.positionSeconds / resumed.durationSeconds) * 100)
            : isWatched
              ? 100
              : 0;
          const minutesLeft = resumed
            ? Math.max(1, Math.round((resumed.durationSeconds - resumed.positionSeconds) / 60))
            : undefined;
          // One quiet line under the title: E3 · 24m, or what matters more right now.
          const status = upcoming
            ? episodeAiringLabel(upcoming)
            : needsInternet
              ? "Needs internet"
              : minutesLeft && progress < 100
                ? `${minutesLeft} min left`
                : `${duration}m`;

          return (
            <div
              key={`${activeSeason?.id ?? "season"}:${episode.id}:${episode.number}`}
              className={`episode-tile-wrap${isWatched && !isCurrent ? " is-watched" : ""}`}
            >
              <button
                type="button"
                className={`episode-tile${isCurrent ? " is-current" : ""}${isWatched && !isCurrent ? " is-watched" : ""}${upcoming ? " is-upcoming" : ""}${needsInternet ? " is-offline" : ""}`}
                aria-label={
                  upcoming || needsInternet
                    ? `Episode ${episode.number}: ${episodeTitle ?? defaultTitle}. ${status}`
                    : `Play episode ${episode.number}: ${episodeTitle ?? defaultTitle}`
                }
                disabled={Boolean(upcoming) || needsInternet}
                onClick={() => onPlay(episode)}
              >
                <span className="episode-tile-frame">
                  {episode.thumbnailUrl ? (
                    <img
                      className="episode-tile-still"
                      src={episode.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      onError={hideBrokenImage}
                    />
                  ) : seriesArt ? (
                    <img
                      className="episode-tile-art"
                      src={seriesArt}
                      alt=""
                      loading="lazy"
                      onError={hideBrokenImage}
                      style={{ objectPosition: `${(index * 29) % 100}% 40%` }}
                    />
                  ) : null}
                  {episode.thumbnailUrl ? null : (
                    <span className="episode-tile-number" aria-hidden="true">
                      {String(episode.number).padStart(2, "0")}
                    </span>
                  )}
                  {isWatched ? (
                    <span className="episode-tile-watched" aria-hidden="true">
                      <Check size={11} strokeWidth={3} />
                      Watched
                    </span>
                  ) : null}
                  {upcoming ? (
                    <span className="episode-upcoming" aria-hidden="true">
                      <Clock3 size={20} />
                    </span>
                  ) : (
                    <span className="episode-play" aria-hidden="true">
                      <Play size={22} fill="currentColor" />
                    </span>
                  )}
                  {progress > 0 ? (
                    <span className="episode-watch-progress" aria-hidden="true">
                      <span style={{ transform: `scaleX(${progress / 100})` }} />
                    </span>
                  ) : null}
                </span>
                <strong title={episodeTitle ?? defaultTitle}>{episodeTitle ?? defaultTitle}</strong>
                <span className="episode-tile-status">
                  <b>E{episode.number}</b>
                  <span aria-hidden="true">·</span>
                  {status}
                </span>
              </button>
              {upcoming ? null : (
                <>
                  <span className="episode-tile-tools">
                    <EpisodeQueueToggle
                      item={animeBingeItem(media, episode.number)}
                      label={`episode ${episode.number}`}
                    />
                  </span>
                  <span className="episode-tile-dl">
                    <EpisodeDownloadToggle
                      media={media}
                      episode={episode.number}
                      minutes={runtime}
                    />
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {episodes.length > EPISODES_PAGE_SIZE ? (
        <button
          type="button"
          className="episode-list-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show fewer episodes" : `Show all ${episodes.length} episodes`}
          <ChevronDown size={18} className={expanded ? "is-expanded" : undefined} />
        </button>
      ) : null}
    </div>
  );
}

/** One renderer-session loader for every season box: two-hop series graphs, cached. */
const loadSeriesDetail = createSeriesLoader((id) => window.anistream.getAnimeSeriesGraph(id));

function SeasonPicker({
  media,
  onNavigate,
  onCurrentNumber,
  ranges,
  activeRange,
  onSelectRange,
  onArcModeChange,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  onNavigate?: (media: AniListCatalogMedia) => void;
  onCurrentNumber: (number: number) => void;
  /** Arcs (or TheTVDB seasons) of a long runner; shown here only when it has no other seasons. */
  ranges?: AnimeEpisodeRanges;
  activeRange?: AnimeEpisodeRange;
  onSelectRange: (range: AnimeEpisodeRange) => void;
  onArcModeChange: (arcMode: boolean) => void;
}): React.JSX.Element | null {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reducedMotion = useAppReducedMotion();
  const inferredSeasonNumber = inferMediaDisplayedSeasonNumber(media);
  const inferredNumber = inferredSeasonNumber ?? 1;
  const currentChoice = useMemo<AnimeSeasonChoice>(
    () => ({
      number: inferredNumber,
      partNumber: inferMediaDisplayedPartNumber(media),
      media,
      episodeCount: media.totalProgress,
      current: true,
    }),
    [inferredNumber, media],
  );
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Keyed by title and attempt: a result for anything else is simply not shown.
  const loadKey = `${media.id}:${attempt}`;
  const [outcome, setOutcome] = useState<{ key: string; series?: AnimeSeries; error?: string }>();
  const settled = outcome?.key === loadKey ? outcome : undefined;
  const series = settled?.series;
  const error = settled?.error;
  const loading = !settled;
  const loaded = series !== undefined;
  const seasons = series?.seasons.length ? series.seasons : [currentChoice];
  const extras = series?.extras ?? [];
  const selected = seasons.find((choice) => choice.current) ?? currentChoice;
  const currentIsSeason = isSeasonEntry(media);
  // A long runner AniList lists without any other season (One Piece) is browsed by arc instead.
  const arcMode = Boolean(
    ranges && activeRange && loaded && currentIsSeason && series.seasons.length <= 1,
  );
  const hasExactPrequel =
    "relations" in media &&
    media.relations.some(
      (relation) => relation.relationType === "PREQUEL" && relation.media.type === "ANIME",
    );
  const awaitingSeasonNumber =
    inferredSeasonNumber === undefined &&
    (!("relations" in media) || hasExactPrequel) &&
    !loaded &&
    !arcMode;

  // The series loads with the title (one or two light requests, cached), not on first open.
  useEffect(() => {
    let active = true;
    const key = `${media.id}:${attempt}`;
    loadSeriesDetail(media.id)
      .then((detail) => buildAnimeSeries(detail, loadSeriesDetail))
      .then((result) => {
        if (!active) return;
        setOutcome({ key, series: result });
        onCurrentNumber(result.seasons.find((choice) => choice.current)?.number ?? inferredNumber);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setOutcome({
          key,
          error: friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "connected seasons",
            fallback: "Connected seasons could not be loaded. Try again shortly.",
          }),
        });
      });
    return () => {
      active = false;
    };
    // `onCurrentNumber` is a state setter from the parent; the walk reruns only per title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, attempt]);

  useEffect(() => onArcModeChange(arcMode), [arcMode, onArcModeChange]);

  useEffect(() => {
    if (!open) return;
    // Long arc lists open on the current entry.
    menuRef.current
      ?.querySelector<HTMLElement>("[aria-checked='true']")
      ?.scrollIntoView({ block: "nearest" });
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  function openAndFocusFirst(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    setOpen(true);
    window.requestAnimationFrame(() => {
      const options =
        pickerRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
      const current = pickerRef.current?.querySelector<HTMLButtonElement>(
        "[role='menuitemradio'][aria-checked='true']",
      );
      (current ?? options?.[0])?.focus();
    });
  }

  function moveOptionFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']"),
    ];
    if (!options.length) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex <= 0 ? options.length - 1 : currentIndex - 1)
            : currentIndex < 0 || currentIndex === options.length - 1
              ? 0
              : currentIndex + 1;
    options[nextIndex]?.focus();
  }

  function choose(action: () => void, current: boolean): void {
    setOpen(false);
    if (current) triggerRef.current?.focus();
    else action();
  }

  const triggerTitle = arcMode
    ? (activeRange?.title ?? "")
    : !currentIsSeason
      ? mediaFormatLabel(media.format)
      : awaitingSeasonNumber
        ? error
          ? "Season unavailable"
          : "Finding season…"
        : seasonChoiceLabel(selected);
  const triggerDetail =
    arcMode && activeRange
      ? rangeEpisodesLabel(activeRange)
      : !currentIsSeason
        ? media.title
        : awaitingSeasonNumber && !error
          ? "Checking AniList"
          : episodeCountLabel(selected.episodeCount);

  // Nothing to pick: AniList lists no prequel, sequel, movie or special for this show, and it is not
  // a long runner browsed by arc (One Piece keeps the box for its arcs). Details that link no other
  // anime at all settle it before the series walk, so the box never flashes up first.
  const standalone =
    "relations" in media && !media.relations.some((relation) => relation.media.type === "ANIME");
  if (!arcMode && (loaded ? seasons.length <= 1 && extras.length === 0 : standalone && !ranges))
    return null;

  return (
    <div className="season-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="season-picker-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={openAndFocusFirst}
      >
        <span>
          <strong>{triggerTitle}</strong>
          <small>{triggerDetail}</small>
        </span>
        <ChevronDown aria-hidden="true" size={18} className={open ? "is-open" : undefined} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            id={menuId}
            className="season-picker-menu"
            role="menu"
            aria-label="Series seasons"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={motionTransition(reducedMotion, "fast")}
            onKeyDown={moveOptionFocus}
          >
            {arcMode && ranges && activeRange ? (
              <>
                <div className="season-picker-menu-heading">
                  <span>Seasons</span>
                  <small>{ranges.kind === "arc" ? "From TMDB" : "From TheTVDB"}</small>
                </div>
                {ranges.ranges.map((range) => {
                  const current = range.start === activeRange.start;
                  return (
                    <button
                      key={range.start}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      className={current ? "is-current" : undefined}
                      onClick={() => choose(() => onSelectRange(range), current)}
                    >
                      <span className="season-picker-option-copy">
                        <strong>{range.title}</strong>
                        <small>
                          {rangeEpisodesLabel(range)}
                          {range.filler ? " · Filler" : ""}
                        </small>
                      </span>
                      {current ? <Check aria-hidden="true" size={17} /> : null}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <div className="season-picker-menu-heading">
                  <span>Seasons</span>
                  <small>From AniList</small>
                </div>
                {seasons.map((choice) => {
                  const current = choice.current && currentIsSeason;
                  return (
                    <button
                      key={choice.media.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      className={current ? "is-current" : undefined}
                      onClick={() => choose(() => onNavigate?.(choice.media), current)}
                    >
                      <span className="season-picker-option-copy">
                        <strong>
                          {seasonChoiceLabel(choice)}{" "}
                          <span>({episodeCountLabel(choice.episodeCount)})</span>
                        </strong>
                        <small>{choice.media.title}</small>
                      </span>
                      {current ? <Check aria-hidden="true" size={17} /> : null}
                    </button>
                  );
                })}
              </>
            )}
            {extras.length ? (
              <>
                <div className="season-picker-menu-heading season-picker-menu-heading--group">
                  <span>Movies &amp; specials</span>
                </div>
                {extras.map((extra) => (
                  <button
                    key={extra.media.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={extra.current}
                    className={extra.current ? "is-current" : undefined}
                    onClick={() => choose(() => onNavigate?.(extra.media), extra.current)}
                  >
                    <span className="season-picker-option-copy">
                      <strong>{extra.media.title}</strong>
                      <small>
                        {mediaFormatLabel(extra.media.format)}
                        {extra.media.seasonYear ? ` · ${extra.media.seasonYear}` : ""}
                      </small>
                    </span>
                    {extra.current ? <Check aria-hidden="true" size={17} /> : null}
                  </button>
                ))}
              </>
            ) : null}
            {loading ? (
              <p className="season-picker-status" role="status">
                <LoaderCircle aria-hidden="true" size={16} /> Loading connected seasons…
              </p>
            ) : null}
            {error ? (
              <div className="season-picker-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                  Retry
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function rangeEpisodesLabel(range: AnimeEpisodeRange): string {
  return range.start === range.end
    ? `Episode ${range.start}`
    : `Episodes ${range.start}–${range.end}`;
}

function mediaFormatLabel(format: string | undefined): string {
  switch (format) {
    case "MOVIE":
      return "Movie";
    case "OVA":
      return "OVA";
    case "ONA":
      return "ONA";
    case "SPECIAL":
      return "Special";
    case "TV_SHORT":
      return "Short";
    case "MUSIC":
      return "Music video";
    default:
      return "TV";
  }
}

function rangeContaining(
  ranges: readonly AnimeEpisodeRange[],
  episode: number,
): AnimeEpisodeRange | undefined {
  return (
    ranges.find((range) => episode >= range.start && episode <= range.end) ??
    (episode > (ranges.at(-1)?.end ?? 0) ? ranges.at(-1) : ranges[0])
  );
}

function episodeCountLabel(count: number | undefined): string {
  if (!count) return "Episodes TBA";
  return `${count} ${count === 1 ? "Episode" : "Episodes"}`;
}

function seasonChoiceLabel(choice: AnimeSeasonChoice): string {
  return `Season ${choice.number}${choice.partNumber ? ` · Part ${choice.partNumber}` : ""}`;
}

function AnimeEmbedPlayer({
  mediaId,
  media,
  title,
  episode,
  source,
  nextEpisode,
  onNext,
  onWatched,
  onRetry,
  onUseBackup,
}: {
  mediaId: number;
  media: AniListCatalogMedia;
  title: string;
  episode: AnimeProviderEpisode;
  source: AnimePlaybackCandidate;
  nextEpisode?: AnimeProviderEpisode;
  onNext: (episode: AnimeProviderEpisode) => void;
  onWatched: (episode: number) => Promise<void>;
  onRetry: () => void;
  /** Hands the episode to the backup (own) player. */
  onUseBackup: () => void;
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const session = useMemo(
    () =>
      createAnimePlaybackSession({
        mediaId,
        playerOrigin: new URL(source.url).origin,
        episode: episode.number,
        saveResume: (input) => saveAnimeActivity(media, input),
        // Completion clears only this episode's checkpoint atomically in the main journal.
        clearResume: () => undefined,
        onWatched,
      }),
    [episode.number, media, mediaId, onWatched, source.url],
  );
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  // A main-player error hands the episode to the backup player by itself (no switch in the UI).
  useEffect(() => {
    if (sessionState.hasError) onUseBackup();
  }, [onUseBackup, sessionState.hasError]);
  // The next episode wins; at the end of what is available, the next Up Next title plays.
  const nextUp = useNextUp(
    nextEpisode
      ? {
          heading: "Next episode",
          title: `E${nextEpisode.number} · ${nextEpisode.title ?? `Episode ${nextEpisode.number}`}`,
          play: () => onNext(nextEpisode),
        }
      : undefined,
    [`anime:${mediaId}`, `anime:${mediaId}:e${episode.number}`],
  );

  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      session.handleMessage(
        event.data,
        event.origin,
        event.source,
        iframeRef.current?.contentWindow ?? null,
      );
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [session]);

  return (
    <div className="anistream-player anime-embed-player">
      <iframe
        ref={iframeRef}
        className="anime-embed-frame"
        src={source.url}
        aria-label={`${title} episode ${episode.number} · ${source.label}`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => session.markLoaded()}
      />

      {sessionState.loadTimedOut || sessionState.hasError ? (
        <div className="anime-embed-notice" role={sessionState.hasError ? "alert" : "status"}>
          <strong>{sessionState.errorMessage ?? "No playback progress received yet."}</strong>
          <p>
            {sessionState.hasError
              ? "The main player reported an error. Switching to the backup player."
              : "Use Play inside the video. If it still does not start, retry or use the backup player."}
          </p>
          <span className="anime-embed-notice-actions">
            <button type="button" onClick={onRetry}>
              Retry player
            </button>
            <button type="button" onClick={onUseBackup}>
              Use backup player
            </button>
          </span>
        </div>
      ) : !sessionState.hasError && !sessionState.ended && !sessionState.loaded ? (
        <div className="anime-embed-loading">
          <PlayerStarting
            title={`Starting ${title} · E${episode.number}`}
            detail={`Loading the player · ${source.label}`}
            backdropUrl={media.bannerUrl ?? media.coverUrl}
          />
        </div>
      ) : null}

      {sessionState.persistenceError ? (
        <div className="watch-player-error" role="alert">
          <p>Progress could not be saved: {sessionState.persistenceError}</p>
          <button type="button" onClick={() => session.retryPersistence()}>
            Retry saving
          </button>
        </div>
      ) : null}

      {sessionState.ended && nextUp ? (
        <AutoplayNext key={`${mediaId}:${episode.number}`} next={nextUp} />
      ) : null}
    </div>
  );
}

/** Applies episode-art details without replacing a genuine provider title or description. */
function withEpisodeArt(episode: AnimeProviderEpisode, art: AnimeEpisodeArt): AnimeProviderEpisode {
  const ownTitle = episode.title?.trim();
  const placeholder = !ownTitle || /^(episode|ep\.?)\s*\d+$/i.test(ownTitle);
  return {
    ...episode,
    ...(art.stillUrl ? { thumbnailUrl: art.stillUrl } : {}),
    ...(placeholder && art.title ? { title: art.title } : {}),
    ...(!episode.description?.trim() && art.synopsis ? { description: art.synopsis } : {}),
  };
}

function fallbackSeason(media: AniListCatalogMedia | AniListMediaDetail): AnimeProviderSeason {
  const count = Math.min(
    Math.max(
      media.totalProgress ?? 0,
      media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 0,
      1,
    ),
    2_000,
  );
  return {
    id: `anilist:${media.id}`,
    number: 1,
    title: "Season 1",
    episodes: Array.from({ length: count }, (_, index) => ({
      id: "",
      number: index + 1,
    })),
  };
}

/**
 * Provider lists stop at the last aired episode. When the list ends right before AniList's next
 * scheduled episode, show that episode too, as a locked tile with its airing time.
 */
function withNextAiringTile(
  seasons: AnimeProviderSeason[],
  media: AniListCatalogMedia | AniListMediaDetail,
): AnimeProviderSeason[] {
  const next = media.nextAiringEpisode;
  const last = seasons.at(-1);
  if (!next || !last || !unairedEpisode(media, next.episode)) return seasons;
  const highest = Math.max(0, ...last.episodes.map((episode) => episode.number));
  if (highest !== next.episode - 1) return seasons;
  return [
    ...seasons.slice(0, -1),
    { ...last, episodes: [...last.episodes, { id: "", number: next.episode }] },
  ];
}

function episodePlaceholder(number: number): AnimeProviderEpisode {
  const normalized = Math.max(1, number);
  return {
    id: "",
    number: normalized,
    title: `Episode ${normalized}`,
  };
}

function seasonContainingEpisode(
  seasons: AnimeProviderSeason[],
  wanted: AnimeProviderEpisode,
): AnimeProviderSeason | undefined {
  return seasons.find((season) => season.episodes.some((episode) => sameEpisode(episode, wanted)));
}

function sameEpisode(left: AnimeProviderEpisode, right: AnimeProviderEpisode): boolean {
  return left.id && right.id ? left.id === right.id : left.number === right.number;
}

function formatLabel(value: string): string {
  return formatMediaLabel(value, "Anime");
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** An image that cannot load (e.g. offline and never cached) disappears instead of showing broken. */
function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.visibility = "hidden";
}
