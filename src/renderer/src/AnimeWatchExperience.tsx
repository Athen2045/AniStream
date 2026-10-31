import { AnimatePresence, motion } from "framer-motion";
import { OwnAnimePlayer } from "./player/OwnAnimePlayer";
import { ArrowLeft, ArrowLeftRight, Play } from "lucide-react";
import { createPortal } from "react-dom";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { getAppPreferences, preferredAudioSource } from "./app-preferences";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimePlaybackCandidate,
  AnimeProviderEpisode,
  PlaybackResume,
} from "../../shared/contracts";
import { unairedEpisode } from "./airing";
import { useOptionalDownloads } from "./DownloadsProvider";
import { downloadKey } from "../../shared/downloads";
import { motionTransition } from "./motion";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";
import { useCaptionControlsVisibility } from "./useCaptionControlsVisibility";
import { friendlyPlaybackError } from "./remote-error";
import { inferMediaDisplayedSeasonNumber } from "./anime-season-chain";
import { playStarted } from "./play-timer";
import { EpisodeBrowser } from "./EpisodeBrowser";
import { episodePlaceholder, seasonContainingEpisode } from "./anime-episode-list";
import { useEpisodeList } from "./useEpisodeList";
import { AnimeEmbedPlayer } from "./AnimeEmbedPlayer";
import { ANIME_BACKUP_PLAYER, animePlayerChoice, animePlayerOrder } from "./anime-player-choice";

type WatchView = "episodes" | "player";

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
  const [activeEpisode, setActiveEpisode] = useState<AnimeProviderEpisode>(() =>
    episodePlaceholder(initialEpisode),
  );
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [view, setView] = useState<WatchView>("episodes");
  // Every embedded player's candidates for the episode, in player order (user decision
  // 2026-10-31: AniList-addressed player → indexed player → backup, switched by hand).
  const [candidates, setCandidates] = useState<AnimePlaybackCandidate[]>([]);
  const [chosenPlayer, setChosenPlayer] = useState<string | undefined>(() =>
    animePlayerChoice.get(media.id),
  );
  const players = useMemo(() => animePlayerOrder(candidates), [candidates]);
  const activePlayer = chosenPlayer && players.includes(chosenPlayer) ? chosenPlayer : players[0];
  const source = useMemo(
    () =>
      activePlayer === ANIME_BACKUP_PLAYER
        ? undefined
        : preferredAudioSource(
            candidates.filter((candidate) => (candidate.player ?? "main") === activePlayer),
            getAppPreferences().audio,
          ),
    [activePlayer, candidates],
  );
  const [resume, setResume] = useState<PlaybackResume>();
  // Read when the player is prepared, so a resume arriving later does not reload it.
  const resumeRef = useRef<PlaybackResume | undefined>(undefined);
  useEffect(() => {
    resumeRef.current = resume;
  }, [resume]);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState<string>();
  const [transitionTarget, setTransitionTarget] = useState<WatchView>();
  const [retryCount, setRetryCount] = useState(0);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const episodeList = useEpisodeList({
    media,
    initialEpisode,
    exactEpisode,
    activeEpisode,
    selectedSeasonId,
    onLoaded: ({ episode, season, saved }) => {
      const chosen = chosenEpisodeRef.current;
      if (chosen !== null) {
        setResume((current) => current ?? (saved?.episode === chosen ? saved : undefined));
        return;
      }
      setResume(saved?.episode === episode.number ? saved : undefined);
      setActiveEpisode(episode);
      setSelectedSeasonId(season?.id ?? "");
    },
  });
  const { catalogMedia, seasons, activeSeason, previousEpisode, nextEpisode } = episodeList;
  const loadingCatalog = episodeList.loading;
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

  // The own player (backup, trial 2026-10-18) takes over for an episode when the main player has
  // no source or reports an error; there is no manual switch in the player (user decision
  // 2026-10-20: audio comes from Settings, the backup is automatic).
  const [backupEpisode, setBackupEpisode] = useState<number>();
  const usingBackup =
    backupEpisode === activeEpisode.number ||
    (activePlayer === ANIME_BACKUP_PLAYER && !loadingPlayback);
  // A downloaded episode plays from the downloads folder in the own player (works offline).
  const downloads = useOptionalDownloads();
  const downloadedEpisode =
    downloads?.byEpisode.get(downloadKey(media.id, activeEpisode.number))?.status === "done";
  const watchedEpisodes = "listEntry" in media ? (media.listEntry?.progress ?? 0) : 0;

  useEffect(() => playStarted("ANIME"), []);

  useEffect(() => {
    if (view !== "player") return;
    // A downloaded episode plays from disk; the main player is not asked at all.
    if (downloadedEpisode) return;
    let active = true;
    const saved = resumeRef.current;

    void window.anistream
      .getAnimePlayback({
        aniListId: media.id,
        title: media.title,
        episode: activeEpisode.number,
        providerEpisodeId: activeEpisode.id || undefined,
        audio: getAppPreferences().audio,
        ...(saved?.episode === activeEpisode.number && saved.positionSeconds > 0
          ? { startAtSeconds: saved.positionSeconds }
          : {}),
      })
      .then((result) => {
        if (!active) return;
        // Each player starts on the audio chosen in Settings when the episode offers it.
        setCandidates(result.candidates.filter((candidate) => candidate.kind === "embed"));
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
      setCandidates([]);
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

  // "Switch player" (top right, as in More): the next player in order, wrapping round; the choice
  // holds for this title until the app restarts.
  const switchPlayer = useCallback((): void => {
    const index = players.indexOf(activePlayer ?? "");
    const next = players[(index + 1) % players.length];
    if (!next) return;
    animePlayerChoice.set(media.id, next);
    setChosenPlayer(next);
    setBackupEpisode(undefined);
    setError(undefined);
    setRetryCount((count) => count + 1);
  }, [activePlayer, media.id, players]);
  const playerPosition = Math.max(0, players.indexOf(activePlayer ?? "")) + 1;
  const canSwitchPlayer = players.length > 1 && !downloadedEpisode && !loadingPlayback;

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
            ranges={episodeList.ranges}
            activeRange={episodeList.activeRange}
            onSelectRange={episodeList.selectRange}
            displayedSeasonNumber={displayedSeasonNumber}
            activeEpisode={activeEpisode}
            resume={resume}
            watchedEpisodes={watchedEpisodes}
            loading={loadingCatalog}
            providerMessage={episodeList.catalog?.message}
            onRetry={episodeList.retry}
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
            {canSwitchPlayer ? (
              <button
                type="button"
                className="watch-caption-tool"
                aria-label="Switch player"
                title={`Switch player (${playerPosition} of ${players.length})`}
                onClick={switchPlayer}
              >
                <ArrowLeftRight size={16} />
              </button>
            ) : null}
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
              onUseMainPlayer={
                players.length > 1
                  ? () => {
                      animePlayerChoice.delete(media.id);
                      setChosenPlayer(undefined);
                      setBackupEpisode(undefined);
                    }
                  : undefined
              }
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
              onSwitchPlayer={players.length > 1 ? switchPlayer : undefined}
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
                    setCandidates([]);
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
