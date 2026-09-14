import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronLeft, LoaderCircle, Play, SkipForward } from "lucide-react";
import { createPortal } from "react-dom";
import { useMediaFullscreen } from "./useMediaFullscreen";
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
  AnimeEpisodeCatalog,
  AnimePlaybackCandidate,
  AnimePlaybackResult,
  AnimeProviderEpisode,
  AnimeProviderSeason,
  PlaybackResume,
} from "../../shared/contracts";
import { chooseInitialAnimeEpisode, createAnimePlaybackSession } from "./anime-playback-session";
import { saveAnimeActivity } from "./local-activity";
import { formatMediaLabel } from "./format-label";
import { motionTransition } from "./motion";
import { useAutoHideMediaControls } from "./useAutoHideMediaControls";
import { friendlyPlaybackError, friendlyRemoteError } from "./remote-error";
import {
  buildAnimeSeasonChain,
  inferMediaDisplayedPartNumber,
  inferMediaDisplayedSeasonNumber,
  type AnimeSeasonChoice,
} from "./anime-season-chain";

const EPISODES_PAGE_SIZE = 10;

type WatchView = "episodes" | "player";

export function AnimeWatchExperience({
  media,
  initialEpisode,
  autoPlayRequest = 0,
  onEpisodeWatched,
  onNavigate,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  initialEpisode: number;
  autoPlayRequest?: number;
  onEpisodeWatched: (episode: number) => Promise<void>;
  onNavigate?: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const { exitFullscreen, isFullscreenEscape } = useMediaFullscreen(rootRef);
  const episodeFocus = useRef<HTMLElement | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useAppReducedMotion();
  const transitionCommitted = useRef(false);
  const handledAutoPlayRequest = useRef(0);
  const pendingEpisodeRef = useRef<AnimeProviderEpisode | null>(null);
  const [catalog, setCatalog] = useState<AnimeEpisodeCatalog>();
  const [activeEpisode, setActiveEpisode] = useState<AnimeProviderEpisode>(() =>
    episodePlaceholder(initialEpisode),
  );
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [view, setView] = useState<WatchView>("episodes");
  const [playback, setPlayback] = useState<AnimePlaybackResult>();
  const [source, setSource] = useState<AnimePlaybackCandidate>();
  const [resume, setResume] = useState<PlaybackResume>();
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState<string>();
  const [transitionTarget, setTransitionTarget] = useState<WatchView>();
  const [retryCount, setRetryCount] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [catalogMedia] = useState(media);
  const [catalogInitialEpisode] = useState(initialEpisode);
  const [resolvedSeasonNumber, setResolvedSeasonNumber] = useState<number>();
  const displayedSeasonNumber = resolvedSeasonNumber ?? inferMediaDisplayedSeasonNumber(media) ?? 1;
  const {
    visible: playerControlsVisible,
    reveal: revealPlayerControls,
    setPinned: setPlayerControlsPinned,
  } = useAutoHideMediaControls();

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
  const seasons = useMemo(
    () => (catalog?.seasons.length ? catalog.seasons : [fallback]),
    [catalog, fallback],
  );
  const activeSeason =
    seasons.find((season) => season.id === selectedSeasonId) ??
    seasonContainingEpisode(seasons, activeEpisode) ??
    seasons[0];
  const allEpisodes = useMemo(() => seasons.flatMap((season) => season.episodes), [seasons]);
  const activeIndex = useMemo(
    () => allEpisodes.findIndex((episode) => sameEpisode(episode, activeEpisode)),
    [allEpisodes, activeEpisode],
  );
  const nextEpisode = useMemo(
    () =>
      activeIndex >= 0 && activeIndex + 1 < allEpisodes.length
        ? allEpisodes[activeIndex + 1]
        : undefined,
    [activeIndex, allEpisodes],
  );
  const embedSources = useMemo(
    () => playback?.candidates.filter((candidate) => candidate.kind === "embed") ?? [],
    [playback],
  );
  const watchedEpisodes = "listEntry" in media ? (media.listEntry?.progress ?? 0) : 0;

  useEffect(() => {
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
              provider: "anikoto" as const,
              seasons: [],
              message: friendlyRemoteError(catalogResult.reason, {
                provider: "Anikoto",
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
  }, [catalogAttempt, fallback, catalogInitialEpisode, catalogMedia, titles]);

  useEffect(() => {
    if (view !== "player") return;
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
        setPlayback(result);
        setSource(result.candidates.find((candidate) => candidate.kind === "embed"));
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
  }, [activeEpisode.id, activeEpisode.number, media.id, media.title, playbackAttempt, view]);

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
      if (view !== "player" && document.activeElement instanceof HTMLElement)
        episodeFocus.current = document.activeElement;
      setResume((current) => (current?.episode === episode.number ? current : undefined));
      setLoadingPlayback(true);
      setPlayback(undefined);
      setSource(undefined);
      setError(undefined);
      setSelectedSeasonId(seasonContainingEpisode(seasons, episode)?.id ?? selectedSeasonId);
      // Defer setActiveEpisode (which triggers the getAnimePlayback IPC/data-fetch effect)
      // until the curtain transition's onAnimationComplete fires, so the IPC round trip
      // doesn't compete with the in-flight 300ms curtain animation for frames.
      pendingEpisodeRef.current = episode;
      transitionTo("player");
    },
    [seasons, selectedSeasonId, transitionTo, view],
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
    playEpisode(activeEpisode);
  }, [activeEpisode, autoPlayRequest, loadingCatalog, playEpisode]);

  const returnToEpisodes = useCallback((): void => {
    void exitFullscreen()
      .catch(() => undefined)
      .then(() => transitionTo("episodes"));
  }, [exitFullscreen, transitionTo]);

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
        <EpisodeBrowser
          key={activeSeason?.id ?? media.id}
          media={media}
          activeSeason={activeSeason}
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
          onPlay={playEpisode}
        />
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
          <div
            className="media-control-layer media-control-layer--player"
            data-visible={playerControlsVisible || !source}
            aria-hidden={!(playerControlsVisible || !source)}
            inert={playerControlsVisible || !source ? undefined : true}
            onFocusCapture={() => setPlayerControlsPinned(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setPlayerControlsPinned(false);
            }}
          >
            <button
              ref={backButtonRef}
              type="button"
              className="watch-player-back"
              aria-label="Back to episode list"
              title="Back to episode list"
              onClick={returnToEpisodes}
            >
              <ChevronLeft size={28} />
              <span>Episodes</span>
            </button>

            <div className="watch-player-heading">
              <span>{media.title}</span>
              <strong>
                S{displayedSeasonNumber}:E{activeEpisode.number}
                {activeEpisode.title ? ` · ${activeEpisode.title}` : ""}
              </strong>
            </div>

            {embedSources.length > 1 ? (
              <label className="watch-source-select">
                <span>Audio</span>
                <select
                  aria-label="Episode audio"
                  value={source?.id ?? ""}
                  onChange={(event) => {
                    const selected = embedSources.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    if (selected) setSource(selected);
                  }}
                >
                  {embedSources.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {source ? (
            <AnikotoEmbedPlayer
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
            />
          ) : (
            <div className="player-unavailable" role="status">
              <Play size={54} />
              <h3>{loadingPlayback ? "Opening Anikoto…" : "Anikoto player unavailable"}</h3>
              <p>
                {loadingPlayback
                  ? "Preparing the approved Anikoto episode embed."
                  : (error ??
                    "This episode is unavailable from the player right now. Try another episode.")}
              </p>
              {!loadingPlayback ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setLoadingPlayback(true);
                    setPlayback(undefined);
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
  const format = media.format ? formatLabel(media.format) : "Anime";
  const runtime = "duration" in media ? media.duration : undefined;
  const [expanded, setExpanded] = useState(false);
  const episodes = activeSeason?.episodes ?? [];
  const visibleEpisodes = expanded ? episodes : episodes.slice(0, EPISODES_PAGE_SIZE);
  const hiddenCount = episodes.length - EPISODES_PAGE_SIZE;

  return (
    <div className="netflix-episode-browser">
      <header className="episode-browser-heading">
        <h2>Episodes</h2>
        <SeasonPicker
          media={media}
          onNavigate={onNavigate}
          onCurrentNumber={onSeasonNumberResolved}
        />
      </header>

      <div className="episode-browser-meta">
        <strong>Season {displayedSeasonNumber}:</strong>
        <span>{format}</span>
        {media.genres.slice(0, 2).map((genre) => (
          <span key={genre}>{genre}</span>
        ))}
      </div>

      {loading ? <p className="catalog-loading">Loading episode details…</p> : null}
      {providerMessage ? (
        <div className="provider-note provider-note--action" role="status">
          <span>{providerMessage}</span>
          <button type="button" onClick={onRetry} disabled={loading}>
            Retry episodes
          </button>
        </div>
      ) : null}

      <div className="netflix-episode-list">
        {visibleEpisodes.map((episode) => {
          const isCurrent = sameEpisode(episode, activeEpisode);
          const isWatched = episode.number <= watchedEpisodes;
          const defaultTitle = `Episode ${episode.number}`;
          const episodeTitle = episode.title?.trim();
          const episodeArt = episode.thumbnailUrl ?? media.bannerUrl ?? media.coverUrl;
          const progress =
            resume?.episode === episode.number && resume.durationSeconds > 0
              ? Math.min(100, (resume.positionSeconds / resume.durationSeconds) * 100)
              : isWatched
                ? 100
                : 0;

          return (
            <button
              key={`${activeSeason?.id ?? "season"}:${episode.id}:${episode.number}`}
              type="button"
              className={isCurrent ? "is-current" : undefined}
              aria-label={`Play episode ${episode.number}: ${episodeTitle ?? defaultTitle}`}
              onClick={() => onPlay(episode)}
            >
              <span className="netflix-episode-number">{episode.number}</span>
              <span className="netflix-episode-thumb">
                {episodeArt ? (
                  <img src={episodeArt} alt="" loading="lazy" />
                ) : (
                  <span className="episode-thumb-fallback">{defaultTitle}</span>
                )}
                <span className="episode-play">
                  <Play size={25} fill="currentColor" />
                </span>
                {progress > 0 ? (
                  <span className="episode-watch-progress" aria-hidden="true">
                    <span style={{ transform: `scaleX(${progress / 100})` }} />
                  </span>
                ) : null}
              </span>
              <span className="netflix-episode-copy">
                <span className="netflix-episode-title">
                  <strong>{episodeTitle ?? defaultTitle}</strong>
                  <span>{episode.durationMinutes ?? runtime ?? 24}m</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {episodes.length > EPISODES_PAGE_SIZE ? (
        <button
          type="button"
          className="episode-list-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer episodes" : `Show ${hiddenCount} more episodes`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown size={22} className={expanded ? "is-expanded" : undefined} />
        </button>
      ) : null}
    </div>
  );
}

function SeasonPicker({
  media,
  onNavigate,
  onCurrentNumber,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  onNavigate?: (media: AniListCatalogMedia) => void;
  onCurrentNumber: (number: number) => void;
}): React.JSX.Element {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  const [choices, setChoices] = useState<AnimeSeasonChoice[]>([currentChoice]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const requestGeneration = useRef(0);
  const loadingRef = useRef(false);
  const visibleChoices = loaded ? choices : [currentChoice];
  const selected = visibleChoices.find((choice) => choice.current) ?? currentChoice;
  const hasExactPrequel =
    "relations" in media &&
    media.relations.some(
      (relation) => relation.relationType === "PREQUEL" && relation.media.type === "ANIME",
    );
  const needsAutomaticResolution = inferredSeasonNumber === undefined && hasExactPrequel;
  const awaitingSeasonNumber =
    inferredSeasonNumber === undefined && (!("relations" in media) || hasExactPrequel) && !loaded;

  const loadChoices = useCallback((): void => {
    if (loadingRef.current || loaded) return;
    const generation = ++requestGeneration.current;
    loadingRef.current = true;
    setLoading(true);
    setError(undefined);
    void (async () => {
      const detail =
        "relations" in media
          ? media
          : await window.anistream.getAniListMediaDetail(media.id, "ANIME");
      return buildAnimeSeasonChain(detail, (id) =>
        window.anistream.getAniListMediaDetail(id, "ANIME"),
      );
    })()
      .then((result) => {
        if (requestGeneration.current !== generation) return;
        const nextChoices = result.length ? result : [currentChoice];
        setChoices(nextChoices);
        onCurrentNumber(nextChoices.find((choice) => choice.current)?.number ?? inferredNumber);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (requestGeneration.current !== generation) return;
        setError(
          friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "connected seasons",
            fallback: "Connected seasons could not be loaded. Try again shortly.",
          }),
        );
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          loadingRef.current = false;
          setLoading(false);
        }
      });
  }, [currentChoice, inferredNumber, loaded, media, onCurrentNumber]);

  useEffect(() => {
    if (needsAutomaticResolution) loadChoices();
  }, [loadChoices, needsAutomaticResolution]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      loadingRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
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

  function toggle(): void {
    const next = !open;
    setOpen(next);
    if (next) loadChoices();
  }

  function openAndFocusFirst(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (!open) {
      setOpen(true);
      loadChoices();
    }
    window.requestAnimationFrame(() => {
      pickerRef.current?.querySelector<HTMLButtonElement>("[role='menuitemradio']")?.focus();
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

  return (
    <div className="season-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="season-picker-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
        onKeyDown={openAndFocusFirst}
      >
        <span>
          <strong>
            {awaitingSeasonNumber
              ? error
                ? "Season unavailable"
                : "Finding season…"
              : seasonChoiceLabel(selected)}
          </strong>
          <small>
            {awaitingSeasonNumber && !error
              ? "Checking AniList"
              : episodeCountLabel(selected.episodeCount)}
          </small>
        </span>
        <ChevronDown aria-hidden="true" size={18} className={open ? "is-open" : undefined} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
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
            <div className="season-picker-menu-heading">
              <span>Series order</span>
              <small>From AniList</small>
            </div>
            {visibleChoices.map((choice) => (
              <button
                key={choice.media.id}
                type="button"
                role="menuitemradio"
                aria-checked={choice.current}
                className={choice.current ? "is-current" : undefined}
                onClick={() => {
                  setOpen(false);
                  if (choice.current) triggerRef.current?.focus();
                  else onNavigate?.(choice.media);
                }}
              >
                <span className="season-picker-option-copy">
                  <strong>
                    {seasonChoiceLabel(choice)}{" "}
                    <span>({episodeCountLabel(choice.episodeCount)})</span>
                  </strong>
                  <small>{choice.media.title}</small>
                </span>
                {choice.current ? <Check aria-hidden="true" size={17} /> : null}
              </button>
            ))}
            {loading ? (
              <p className="season-picker-status" role="status">
                <LoaderCircle aria-hidden="true" size={16} /> Loading connected seasons…
              </p>
            ) : null}
            {error ? (
              <div className="season-picker-error" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoaded(false);
                    setError(undefined);
                    loadChoices();
                  }}
                >
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

function episodeCountLabel(count: number | undefined): string {
  if (!count) return "Episodes TBA";
  return `${count} ${count === 1 ? "Episode" : "Episodes"}`;
}

function seasonChoiceLabel(choice: AnimeSeasonChoice): string {
  return `Season ${choice.number}${choice.partNumber ? ` · Part ${choice.partNumber}` : ""}`;
}

function AnikotoEmbedPlayer({
  mediaId,
  media,
  title,
  episode,
  source,
  nextEpisode,
  onNext,
  onWatched,
  onRetry,
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
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const session = useMemo(
    () =>
      createAnimePlaybackSession({
        mediaId,
        episode: episode.number,
        saveResume: (input) => saveAnimeActivity(media, input),
        // Completion clears only this episode's checkpoint atomically in the main journal.
        clearResume: () => undefined,
        onWatched,
      }),
    [episode.number, media, mediaId, onWatched],
  );
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
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
    <div className="anistream-player anikoto-player">
      <iframe
        ref={iframeRef}
        className="anikoto-embed"
        src={source.url}
        title={`${title} episode ${episode.number} · ${source.label}`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => session.markLoaded()}
      />

      {sessionState.loadTimedOut || sessionState.hasError ? (
        <div className="anikoto-player-notice" role={sessionState.hasError ? "alert" : "status"}>
          <strong>{sessionState.errorMessage ?? "No playback progress received yet."}</strong>
          <p>
            {sessionState.hasError
              ? "The embedded player reported an error. Its controls remain available; you can retry or choose another audio option."
              : "Use Play inside the video. If it still does not start, retry the player."}
          </p>
          <button type="button" onClick={onRetry}>
            Retry player
          </button>
        </div>
      ) : !sessionState.hasError && !sessionState.ended && !sessionState.loaded ? (
        <div className="anikoto-player-loading" role="status">
          <span className="spinner" />
          <strong>Loading MegaPlay player…</strong>
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

      {sessionState.ended && nextEpisode ? (
        <button className="next-preview" type="button" onClick={() => onNext(nextEpisode)}>
          <span>Next episode</span>
          <strong>
            E{nextEpisode.number} · {nextEpisode.title ?? `Episode ${nextEpisode.number}`}
          </strong>
          <SkipForward size={22} />
        </button>
      ) : null}
    </div>
  );
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
