import { AnimatePresence, motion } from "framer-motion";
import { OwnAnimePlayer } from "./player/OwnAnimePlayer";
import { ArrowLeft, Play } from "lucide-react";
import { createPortal } from "react-dom";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { getAppPreferences, preferredAudioSource } from "./app-preferences";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeArt,
  AnimeEpisodeCatalog,
  AnimeEpisodeRanges,
  AnimePlaybackCandidate,
  AnimeProviderEpisode,
  AnimeProviderSeason,
  PlaybackResume,
} from "../../shared/contracts";
import { chooseInitialAnimeEpisode } from "./anime-playback-session";
import { unairedEpisode } from "./airing";
import { useOptionalDownloads } from "./DownloadsProvider";
import { downloadKey } from "../../shared/downloads";
import { formatMediaLabel } from "./format-label";
import { motionTransition } from "./motion";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";
import { useCaptionControlsVisibility } from "./useCaptionControlsVisibility";
import { friendlyPlaybackError, friendlyRemoteError } from "./remote-error";
import { inferMediaDisplayedSeasonNumber } from "./anime-season-chain";
import { playStarted } from "./play-timer";
import { EpisodeBrowser, sameEpisode } from "./EpisodeBrowser";
import { AnimeEmbedPlayer } from "./AnimeEmbedPlayer";
import { rangeContaining } from "./SeasonPicker";

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
  // An episode the viewer played: the episode list arriving later must not swap it for the
  // resume pick (pressing Play on E2 while the list loaded used to jump to E1's saved spot).
  const chosenEpisodeRef = useRef<number | null>(null);
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
      const chosen = chosenEpisodeRef.current;
      if (chosen !== null) {
        setCatalog(nextCatalog);
        setResume((current) => current ?? (saved?.episode === chosen ? saved : undefined));
        setLoadingCatalog(false);
        return;
      }
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
      chosenEpisodeRef.current = episode.number;
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

  // Closed to the tray (background mode): stop playing, as Back would.
  useEffect(() => {
    if (view !== "player") return;
    return window.anistream.onWindowHidden(returnToEpisodes);
  }, [returnToEpisodes, view]);

  useEffect(() => {
    if (view !== "player") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      // An open menu (the own player's Settings) closes first, on its own Esc.
      if (event.key === "Escape" && !rootRef.current?.querySelector('[role="menu"]')) {
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

function formatLabel(value: string): string {
  return formatMediaLabel(value, "Anime");
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
