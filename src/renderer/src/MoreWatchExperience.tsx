import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import { PlayerStarting } from "./PlayerStarting";
import appIcon from "./assets/app-icon.png";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { MoreCatalogItem, MoreMediaType, MorePlayerSource } from "../../shared/contracts";
import { createMorePlaybackSession, readMorePlayerMessage } from "./more-playback-session";
import {
  morePlayerFallbacks,
  nextMorePlayerAfterFailure,
  nextMorePlayerManually,
} from "./more-player-fallback";
import { createMorePlayerLoadGuard } from "./more-player-load-guard";
import { friendlyMorePlayerError } from "./remote-error";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";
import { useCaptionControlsVisibility } from "./useCaptionControlsVisibility";
import { useMediaFullscreen } from "./useMediaFullscreen";
import { AutoplayNext, useNextUp, type NextUp } from "./AutoplayNext";
import { playStarted } from "./play-timer";

/**
 * How long one server gets to start playing before the next is tried. The slowest successful start
 * in the 2026-10-05 benchmark (14 titles x 4 servers) was 13 s.
 */
const PLAYER_START_TIMEOUT_MS = 20_000;
const LOAD_FAILED_MESSAGE = "This server could not play the title.";
const NOT_AVAILABLE_TITLE = "Oops! Media not available to play";
const NOT_AVAILABLE_MESSAGE =
  "None of the servers could play this title right now. Try again in a moment.";
/** Rotating verbs for the availability check, one per server tried. */
const CHECK_VERBS = ["Reaching", "Checking", "Asking", "Waking"] as const;

interface PlayerAttempt {
  /** Unique per attempt so each one gets a fresh playback session. */
  id: number;
  /** Configured player to load (0 = primary). */
  providerIndex: number;
  /** Player this round of automatic fallback began with; reaching it again means all failed. */
  startedAt: number;
  /** Set when the app moved here automatically because the previous player failed. */
  automatic: boolean;
}

/**
 * Frames the configured More player inside the app's player surface, the same surface the anime
 * player uses (below the navbar, auto-hiding back/title bar). Main builds the URL from the local
 * provider config and arms a frame-scoped User-Agent override before the iframe exists (see
 * more-player-frame-ua.ts).
 */
export function MoreWatchExperience({
  item,
  season,
  episode,
  next,
  currentKeys = [],
  onClose,
}: {
  item: MoreCatalogItem;
  season: number;
  episode: number;
  /** The next episode of this show, when the parent knows one. */
  next?: NextUp;
  /** Up Next keys for what is playing, so the queue never offers it again. */
  currentKeys?: readonly string[];
  onClose: () => void;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadGuardRef = useRef<ReturnType<typeof createMorePlayerLoadGuard> | null>(null);
  const { fullscreen, toggleFullscreen, isFullscreenEscape } = useMediaFullscreen(rootRef);
  const {
    visible: controlsVisible,
    reveal: revealControls,
    setPinned: setControlsPinned,
  } = useAutoHideMediaControls();
  const [source, setSource] = useState<MorePlayerSource>();
  const src = source?.url;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState<PlayerAttempt>(() => {
    const providerIndex = morePlayerFallbacks.initial(item.id, item.type);
    return { id: 0, providerIndex, startedAt: providerIndex, automatic: false };
  });
  const playbackInput = useMemo(
    () =>
      item.type === "TV"
        ? { tmdbId: item.id, type: item.type as MoreMediaType, season, episode }
        : { tmdbId: item.id, type: item.type as MoreMediaType },
    [episode, item.id, item.type, season],
  );
  const session = useMemo(
    () =>
      createMorePlaybackSession({
        tmdbId: item.id,
        type: item.type,
        attempt: attempt.id,
        season: playbackInput.season,
        episode: playbackInput.episode,
        saveResume: (input) => window.anistream.saveMorePlaybackResume(input),
        clearResume: () => window.anistream.clearMorePlaybackResume(playbackInput),
      }),
    [item.id, item.type, playbackInput, attempt.id],
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const nextUp = useNextUp(next, currentKeys);
  const failed = Boolean(error) || snapshot.hasError;
  const playerOrigin = useMemo(() => (src ? new URL(src).origin : undefined), [src]);
  const showFrame = Boolean(src && playerOrigin && !failed);
  // Windowed, the controls live in their own strip above the video and stay visible; only
  // display fullscreen hides them while idle.
  const controlsShown = controlsVisible || !showFrame || !fullscreen;
  useCaptionControlsVisibility(true, controlsShown);

  useEffect(() => playStarted("MORE"), []);

  useEffect(() => {
    session.activate();
    let active = true;
    void window.anistream
      .getMorePlaybackResume(playbackInput)
      .then((resume) =>
        window.anistream.prepareMorePlayer({
          ...playbackInput,
          startAtSeconds: resume?.positionSeconds,
          providerIndex: attempt.providerIndex,
        }),
      )
      .then((prepared) => {
        if (active) setSource(prepared);
      })
      .catch((reason: unknown) => {
        if (active) setError(friendlyMorePlayerError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      session.dispose();
      setSource(undefined);
      void window.anistream.releaseMorePlayer();
    };
  }, [attempt.providerIndex, playbackInput, session]);

  // A player that cannot serve this title (no source, error, load timeout) hands over to the next
  // configured player. The switch is remembered for this title until the app restarts.
  const exhausted =
    failed &&
    source !== undefined &&
    nextMorePlayerAfterFailure(source, attempt.startedAt) === undefined;
  useEffect(() => {
    if (!failed || !source || source.providerIndex !== attempt.providerIndex) return;
    const next = nextMorePlayerAfterFailure(source, attempt.startedAt);
    if (next === undefined) {
      morePlayerFallbacks.forget(item.id, item.type);
      return;
    }
    setError(undefined);
    setLoading(true);
    setAttempt((current) => ({
      id: current.id + 1,
      providerIndex: next,
      startedAt: current.startedAt,
      automatic: true,
    }));
  }, [attempt.providerIndex, attempt.startedAt, failed, item.id, item.type, source]);

  // Reopening this title starts with the server that last played it (until the app restarts).
  useEffect(() => {
    if (snapshot.started && source?.providerIndex === attempt.providerIndex)
      morePlayerFallbacks.remember(item.id, item.type, attempt.providerIndex);
  }, [attempt.providerIndex, item.id, item.type, snapshot.started, source]);

  // A server must actually start playing within the window; a page that loads but shows its own
  // "no source" screen never reports an error, so loading alone is not enough.
  useEffect(() => {
    if (!src || failed) return;
    const guard = createMorePlayerLoadGuard(
      () => setError(LOAD_FAILED_MESSAGE),
      PLAYER_START_TIMEOUT_MS,
    );
    loadGuardRef.current = guard;
    guard.start();
    return () => {
      guard.dispose();
      if (loadGuardRef.current === guard) loadGuardRef.current = null;
    };
  }, [failed, src]);

  useEffect(() => {
    if (snapshot.started) loadGuardRef.current?.markLoaded();
  }, [snapshot.started]);

  useEffect(() => {
    if (!playerOrigin) return;
    const handler = (event: MessageEvent<unknown>): void => {
      const message = readMorePlayerMessage({
        data: event.data,
        origin: event.origin,
        source: event.source,
        playerOrigin,
        frameWindow: iframeRef.current?.contentWindow ?? null,
      });
      if (message) session.handleEvent(message);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [playerOrigin, session]);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Keys only reach the app while focus is outside the player frame.
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea");
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "f" || event.key === "F") {
          event.preventDefault();
          void toggleFullscreen();
          return;
        }
      }
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      if (!isFullscreenEscape()) close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [close, isFullscreenEscape, toggleFullscreen]);

  useEffect(() => {
    backButtonRef.current?.focus();
    // Initial focus exposes Back to assistive technology without pinning the bar forever.
    setControlsPinned(false);
  }, [setControlsPinned]);

  function retryPlayback(): void {
    // A manual retry starts again from the primary player.
    morePlayerFallbacks.forget(item.id, item.type);
    setError(undefined);
    setLoading(true);
    setAttempt((current) => ({
      id: current.id + 1,
      providerIndex: 0,
      startedAt: 0,
      automatic: false,
    }));
  }

  function switchPlayer(): void {
    if (!source) return;
    const next = nextMorePlayerManually(source);
    morePlayerFallbacks.remember(item.id, item.type, next);
    setError(undefined);
    setLoading(true);
    setAttempt((current) => ({
      id: current.id + 1,
      providerIndex: next,
      startedAt: next,
      automatic: false,
    }));
  }

  const multiplePlayers = (source?.providerCount ?? 0) > 1;
  // Show the failure only once no further player will be tried automatically.
  const showFailure = failed && (exhausted || !source);
  const serverCount = source?.providerCount;
  const checkLabel = `${CHECK_VERBS[attempt.id % CHECK_VERBS.length]} server ${
    attempt.providerIndex + 1
  }${serverCount && serverCount > 1 ? ` of ${serverCount}` : ""}…`;
  const startingTitle = `Starting ${item.title}${item.type === "TV" ? ` · S${season} E${episode}` : ""}`;
  const fellBack = attempt.automatic && attempt.providerIndex !== attempt.startedAt;
  const players =
    serverCount && serverCount > 1
      ? {
          total: serverCount,
          current: attempt.providerIndex,
          tried: triedPlayers(attempt, serverCount),
        }
      : undefined;
  const startingDetail = (busy: boolean): string =>
    fellBack
      ? "The previous player had nothing for this, so AniStream is trying the next one."
      : busy
        ? checkLabel
        : "Preparing the player…";

  return createPortal(
    <section
      ref={rootRef}
      className="watch-experience watch-experience--player more-watch-experience"
      aria-label={`${item.title} player`}
    >
      <div
        className="watch-player-view"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.title} player`}
        onPointerMove={(event) => {
          if (event.clientY - event.currentTarget.getBoundingClientRect().top <= 120)
            revealControls();
        }}
        onPointerDownCapture={(event) => {
          if (!(event.target instanceof Element)) return;
          if (!event.target.closest(".media-control-layer")) setControlsPinned(false);
        }}
      >
        <div
          className="media-control-reveal-zone"
          aria-hidden="true"
          onPointerMove={revealControls}
        />
        {/* Hidden controls keep their footprint hoverable so they reappear where the pointer is. */}
        <div
          className="media-control-hotspot media-control-hotspot--back"
          aria-hidden="true"
          onPointerMove={revealControls}
        />
        {multiplePlayers && source ? (
          <div
            className="media-control-hotspot media-control-hotspot--caption"
            aria-hidden="true"
            onPointerMove={revealControls}
          />
        ) : null}
        <div
          className="media-control-layer media-control-layer--player"
          data-visible={controlsShown}
          aria-hidden={!controlsShown}
          inert={controlsShown ? undefined : true}
          onFocusCapture={() => setControlsPinned(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setControlsPinned(false);
          }}
        >
          {/* Window drag area between the controls; display fullscreen has no window to drag. */}
          {!fullscreen ? <div className="player-drag-strip" aria-hidden="true" /> : null}
          <button
            ref={backButtonRef}
            type="button"
            className="watch-player-back"
            aria-label="Back to details"
            title="Back to details (Esc)"
            onClick={close}
          >
            <ChevronLeft size={22} />
          </button>
          {/* Title, fullscreen, and pause/play stay in the player's own controls; F still
              toggles display fullscreen. */}
          {multiplePlayers && source ? (
            <button
              type="button"
              className="watch-caption-tool"
              aria-label="Switch player"
              title={`Switch player (${source.providerIndex + 1} of ${source.providerCount})`}
              onClick={switchPlayer}
            >
              <ArrowLeftRight size={16} />
            </button>
          ) : null}
        </div>

        {showFrame && src && playerOrigin ? (
          <div className="anistream-player">
            <iframe
              ref={iframeRef}
              className="anime-embed-frame"
              src={src}
              aria-label={`Player for ${item.title}`}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => {
                session.markLoaded();
                // Documented status request; sent only to the exact configured player origin.
                iframeRef.current?.contentWindow?.postMessage(
                  { command: "getStatus" },
                  playerOrigin,
                );
              }}
              onError={() => setError(LOAD_FAILED_MESSAGE)}
            />
            {/* The frame keeps loading underneath so it can autoplay; it shows once it plays. */}
            {!snapshot.started ? (
              <MoreAvailabilityCheck
                backdropUrl={item.backdropUrl}
                title={startingTitle}
                detail={startingDetail(true)}
                players={players}
              />
            ) : null}
          </div>
        ) : showFailure ? (
          <div className="more-availability more-availability--failed" role="alert">
            <MoreAvailabilityBackdrop backdropUrl={item.backdropUrl} />
            <img className="more-availability-logo" src={appIcon} alt="" aria-hidden="true" />
            <h3>{exhausted && multiplePlayers ? NOT_AVAILABLE_TITLE : "Player unavailable"}</h3>
            <p>
              {exhausted && multiplePlayers
                ? NOT_AVAILABLE_MESSAGE
                : (error ?? snapshot.errorMessage)}
            </p>
            <div className="more-availability-actions">
              <button type="button" onClick={close}>
                Go Back
              </button>
              <button type="button" className="primary" onClick={retryPlayback}>
                Try Again
              </button>
            </div>
          </div>
        ) : (
          <MoreAvailabilityCheck
            backdropUrl={item.backdropUrl}
            title={startingTitle}
            detail={startingDetail(loading || !source)}
            players={players}
          />
        )}

        {snapshot.ended && nextUp ? <AutoplayNext next={nextUp} /> : null}

        {snapshot.persistenceError ? (
          <div className="watch-player-error" role="alert">
            <p>Progress could not be saved: {snapshot.persistenceError}</p>
            <button type="button" onClick={() => session.retryPersistence()}>
              Retry saving
            </button>
          </div>
        ) : null}
      </div>
    </section>,
    document.body,
  );
}

function MoreAvailabilityBackdrop({ backdropUrl }: { backdropUrl?: string }): React.JSX.Element {
  return (
    <div
      className="more-availability-backdrop"
      aria-hidden="true"
      style={backdropUrl ? { backgroundImage: `url("${backdropUrl}")` } : undefined}
    />
  );
}

/** Covers the player while servers are checked in order; the first one that plays is shown. */
function MoreAvailabilityCheck({
  backdropUrl,
  title,
  detail,
  players,
}: {
  backdropUrl?: string;
  title: string;
  detail: string;
  players?: { total: number; current: number; tried: readonly number[] };
}): React.JSX.Element {
  return (
    <div className="more-availability more-availability--starting">
      <PlayerStarting title={title} detail={detail} backdropUrl={backdropUrl} players={players} />
    </div>
  );
}

/** Players this round of automatic fallback already tried (in order from where it began). */
function triedPlayers(attempt: PlayerAttempt, total: number): number[] {
  const tried: number[] = [];
  for (
    let index = attempt.startedAt;
    index !== attempt.providerIndex;
    index = (index + 1) % total
  ) {
    tried.push(index);
    if (tried.length >= total) break;
  }
  return tried;
}
