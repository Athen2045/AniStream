import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronLeft, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { parseMegaPlayEvent } from "../../shared/megaplay-events";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";

const MEGAPLAY_ORIGIN = "https://megaplay.buzz";
const EPISODES_PAGE_SIZE = 10;

type WatchView = "episodes" | "player";

export function AnimeWatchExperience({
  media,
  initialEpisode,
  autoPlayRequest = 0,
  onEpisodeWatched,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  initialEpisode: number;
  autoPlayRequest?: number;
  onEpisodeWatched: (episode: number) => Promise<void>;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
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

  const titles = useMemo(() => {
    const detailTitles =
      "synonyms" in media
        ? [media.title, media.titleEnglish, media.titleRomaji, media.titleNative, ...media.synonyms]
        : [media.title];
    return [...new Set(detailTitles.filter(isNonEmptyString))].slice(0, 8);
  }, [media]);

  const fallback = useMemo(() => fallbackSeason(media), [media]);
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
        aniListId: media.id,
        titles,
        seasonLabel:
          media.season && media.seasonYear
            ? `${formatLabel(media.season)} ${media.seasonYear}`
            : "Season 1",
        totalEpisodes: Math.max(
          media.totalProgress ?? 0,
          media.nextAiringEpisode ? media.nextAiringEpisode.episode - 1 : 0,
          initialEpisode,
        ),
        fallbackThumbnailUrl: media.bannerUrl ?? media.coverUrl,
        fallbackDescription: plainText(media.description),
      }),
      window.anistream.getPlaybackResume(media.id),
    ]).then(([catalogResult, resumeResult]) => {
      if (!active) return;

      const nextCatalog =
        catalogResult.status === "fulfilled"
          ? catalogResult.value
          : {
              status: "unavailable" as const,
              provider: "anikoto" as const,
              seasons: [],
              message: messageFrom(catalogResult.reason, "Anikoto episode data is unavailable."),
              checkedAt: new Date().toISOString(),
            };
      const saved = resumeResult.status === "fulfilled" ? resumeResult.value : undefined;
      const wantedEpisode = saved?.episode ?? Math.max(1, initialEpisode);
      const nextSeasons = nextCatalog.seasons.length ? nextCatalog.seasons : [fallback];
      const providerEpisode =
        nextSeasons
          .flatMap((season) => season.episodes)
          .find((episode) => episode.number === wantedEpisode) ?? episodePlaceholder(wantedEpisode);
      const providerSeason =
        seasonContainingEpisode(nextSeasons, providerEpisode) ?? nextSeasons[0];

      setCatalog(nextCatalog);
      setResume(saved);
      setActiveEpisode(providerEpisode);
      setSelectedSeasonId(providerSeason?.id ?? "");
      setLoadingCatalog(false);
    });

    return () => {
      active = false;
    };
  }, [
    fallback,
    initialEpisode,
    media.bannerUrl,
    media.coverUrl,
    media.description,
    media.id,
    media.nextAiringEpisode,
    media.season,
    media.seasonYear,
    media.totalProgress,
    titles,
  ]);

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
      })
      .catch((reason: unknown) => {
        if (active) setError(messageFrom(reason, "Unable to resolve playback sources."));
      })
      .finally(() => {
        if (active) setLoadingPlayback(false);
      });

    return () => {
      active = false;
    };
  }, [activeEpisode.id, activeEpisode.number, media.id, media.title, view]);

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
    (episode: AnimeProviderEpisode, requestFullscreen: boolean): void => {
      const root = rootRef.current;
      if (requestFullscreen && root && !document.fullscreenElement) {
        void root.requestFullscreen().catch(() => undefined);
      }

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
    [seasons, selectedSeasonId, transitionTo],
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
    const preferredEpisode =
      allEpisodes.find((episode) => episode.number === initialEpisode) ?? activeEpisode;
    playEpisode(preferredEpisode, false);
  }, [activeEpisode, allEpisodes, autoPlayRequest, initialEpisode, loadingCatalog, playEpisode]);

  const returnToEpisodes = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => transitionTo("episodes"));
      return;
    }
    transitionTo("episodes");
  }, [transitionTo]);

  useEffect(() => {
    if (view !== "player") return;
    const handleFullscreenChange = (): void => {
      if (!document.fullscreenElement) transitionTo("episodes");
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [transitionTo, view]);

  useEffect(() => {
    if (view !== "player") return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !document.fullscreenElement) returnToEpisodes();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [returnToEpisodes, view]);

  useEffect(() => {
    if (view === "player") backButtonRef.current?.focus();
  }, [view]);

  return (
    <section
      ref={rootRef}
      className={`watch-experience watch-experience--${view}`}
      aria-label={`${media.title} episodes and player`}
    >
      {view === "episodes" ? (
        <EpisodeBrowser
          key={activeSeason?.id ?? media.id}
          media={media}
          seasons={seasons}
          activeSeason={activeSeason}
          activeEpisode={activeEpisode}
          resume={resume}
          watchedEpisodes={watchedEpisodes}
          loading={loadingCatalog}
          providerMessage={catalog?.message}
          onSeasonChange={setSelectedSeasonId}
          onPlay={(episode) => playEpisode(episode, true)}
        />
      ) : (
        <div
          className="watch-player-view"
          role="dialog"
          aria-modal="true"
          aria-label={`${media.title} player`}
        >
          <button
            ref={backButtonRef}
            type="button"
            className="watch-player-back"
            aria-label="Back to episode list"
            onClick={returnToEpisodes}
          >
            <ChevronLeft size={28} />
            <span>Episodes</span>
          </button>

          <div className="watch-player-heading">
            <span>{media.title}</span>
            <strong>
              S{activeSeason?.number ?? 1}:E{activeEpisode.number}
              {activeEpisode.title ? ` · ${activeEpisode.title}` : ""}
            </strong>
          </div>

          {source ? (
            <AnikotoEmbedPlayer
              key={`${activeEpisode.number}:${source.id}:${retryCount}`}
              mediaId={media.id}
              title={media.title}
              episode={activeEpisode}
              source={source}
              resume={resume?.episode === activeEpisode.number ? resume : undefined}
              nextEpisode={nextEpisode}
              onNext={(episode) => playEpisode(episode, false)}
              onWatched={onEpisodeWatched}
              onError={setError}
              onRetry={() => setRetryCount((count) => count + 1)}
            />
          ) : (
            <div className="player-unavailable" role="status">
              <Play size={54} />
              <h3>{loadingPlayback ? "Opening Anikoto…" : "Anikoto player unavailable"}</h3>
              <p>
                {loadingPlayback
                  ? "Preparing the approved Anikoto episode embed."
                  : (playback?.message ?? "Anikoto returned no playable embed for this episode.")}
              </p>
            </div>
          )}

          {error ? <p className="watch-player-error">{error}</p> : null}

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
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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
}

function EpisodeBrowser({
  media,
  seasons,
  activeSeason,
  activeEpisode,
  resume,
  watchedEpisodes,
  loading,
  providerMessage,
  onSeasonChange,
  onPlay,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  seasons: AnimeProviderSeason[];
  activeSeason?: AnimeProviderSeason;
  activeEpisode: AnimeProviderEpisode;
  resume?: PlaybackResume;
  watchedEpisodes: number;
  loading: boolean;
  providerMessage?: string;
  onSeasonChange: (seasonId: string) => void;
  onPlay: (episode: AnimeProviderEpisode) => void;
}): React.JSX.Element {
  const description = plainText(media.description);
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
        <label className="season-picker">
          <span className="sr-only">Season</span>
          <select
            value={activeSeason?.id ?? ""}
            onChange={(event) => onSeasonChange(event.target.value)}
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.title}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={18} />
        </label>
      </header>

      <div className="episode-browser-meta">
        <strong>{activeSeason?.title ?? "Season 1"}:</strong>
        <span>{format}</span>
        {media.genres.slice(0, 2).map((genre) => (
          <span key={genre}>{genre}</span>
        ))}
      </div>

      {loading ? <p className="catalog-loading">Loading episode details…</p> : null}
      {providerMessage ? <p className="provider-note">{providerMessage}</p> : null}

      <div className="netflix-episode-list">
        {visibleEpisodes.map((episode) => {
          const isCurrent = sameEpisode(episode, activeEpisode);
          const isWatched = episode.number <= watchedEpisodes;
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
              aria-label={`Play episode ${episode.number}: ${episode.title ?? `Episode ${episode.number}`}`}
              onClick={() => onPlay(episode)}
            >
              <span className="netflix-episode-number">{episode.number}</span>
              <span className="netflix-episode-thumb">
                {(episode.thumbnailUrl ?? media.bannerUrl ?? media.coverUrl) ? (
                  <img
                    src={episode.thumbnailUrl ?? media.bannerUrl ?? media.coverUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="episode-thumb-fallback">{media.title}</span>
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
                  <strong>{episode.title ?? `Episode ${episode.number}`}</strong>
                  <span>{episode.durationMinutes ?? runtime ?? 24}m</span>
                </span>
                <small>
                  {episode.description ??
                    description ??
                    `${media.title}, episode ${episode.number}.`}
                </small>
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

function AnikotoEmbedPlayer({
  mediaId,
  title,
  episode,
  source,
  resume,
  nextEpisode,
  onNext,
  onWatched,
  onError,
  onRetry,
}: {
  mediaId: number;
  title: string;
  episode: AnimeProviderEpisode;
  source: AnimePlaybackCandidate;
  resume?: PlaybackResume;
  nextEpisode?: AnimeProviderEpisode;
  onNext: (episode: AnimeProviderEpisode) => void;
  onWatched: (episode: number) => Promise<void>;
  onError: (message: string) => void;
  onRetry: () => void;
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const markedRef = useRef(false);
  const completedRef = useRef(false);
  const lastSavedAt = useRef(0);
  const latestProgress = useRef<{ currentTime: number; duration: number } | undefined>(undefined);
  const loadedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [hasProgressed, setHasProgressed] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [ended, setEnded] = useState(false);

  const reportError = useCallback(
    (message: string): void => {
      setHasError(true);
      onError(message);
    },
    [onError],
  );

  // Mount-scoped timeout: this whole component remounts (via its parent `key`, which
  // includes episode number, source id, and a retry counter) whenever a new episode/source
  // is selected or the user retries, so a plain-mount effect is equivalent to keying on
  // those values directly.
  useEffect(() => {
    loadedRef.current = false;
    const timer = setTimeout(() => {
      if (!loadedRef.current) setLoadTimedOut(true);
    }, 15_000);
    return () => clearTimeout(timer);
  }, []);

  const saveResume = useCallback(
    (currentTime: number, duration: number, force = false): void => {
      const now = Date.now();
      if (!force && now - lastSavedAt.current < 10_000) return;
      lastSavedAt.current = now;
      void window.anistream.savePlaybackResume({
        aniListId: mediaId,
        episode: episode.number,
        positionSeconds: Math.max(0, currentTime),
        durationSeconds: duration,
      });
    },
    [episode.number, mediaId],
  );

  useEffect(
    () => () => {
      const progress = latestProgress.current;
      if (progress) saveResume(progress.currentTime, progress.duration, true);
    },
    [saveResume],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== MEGAPLAY_ORIGIN || event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const message = parseMegaPlayEvent(event.data);
      if (!message) return;

      if (message.kind === "progress") {
        setHasProgressed(true);
        const ratio = message.percent ?? (message.currentTime / message.duration) * 100;
        if (!markedRef.current && ratio >= 90) {
          markedRef.current = true;
          completedRef.current = true;
          latestProgress.current = undefined;
          void window.anistream.clearPlaybackResume(mediaId);
          void onWatched(episode.number);
        } else if (!completedRef.current) {
          latestProgress.current = {
            currentTime: message.currentTime,
            duration: message.duration,
          };
          saveResume(message.currentTime, message.duration);
        }
        return;
      }

      if (message.kind === "complete") {
        const shouldMark = !markedRef.current;
        markedRef.current = true;
        completedRef.current = true;
        latestProgress.current = undefined;
        setEnded(true);
        void window.anistream.clearPlaybackResume(mediaId);
        if (shouldMark) void onWatched(episode.number);
        return;
      }

      reportError(message.message ?? "The Anikoto player reported a playback error.");
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [episode.number, mediaId, onWatched, reportError, saveResume]);

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
        onLoad={() => {
          loadedRef.current = true;
          setLoaded(true);
        }}
      />

      {loadTimedOut ? (
        <div className="anikoto-player-loading anikoto-player-error" role="alert">
          <strong>The Anikoto player didn&apos;t respond in time.</strong>
          <p>The embed may be slow, blocked, or unavailable.</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : !hasError && !ended && !(loaded && hasProgressed) ? (
        <div className="anikoto-player-loading" role="status">
          <span className="spinner" />
          <strong>Loading Anikoto player…</strong>
        </div>
      ) : null}

      {resume && resume.positionSeconds > 0 ? (
        <p className="anikoto-resume-note">
          Saved at {formatPlaybackTime(resume.positionSeconds)} · Anikoto controls playback position
        </p>
      ) : null}

      {ended && nextEpisode ? (
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
      title: `Episode ${index + 1}`,
      thumbnailUrl: media.bannerUrl ?? media.coverUrl,
      description: plainText(media.description),
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

function plainText(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replaceAll(/<br\s*\/?>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const decoded = decodeHtmlEntities(text);
  return decoded || undefined;
}

function formatLabel(value: string): string {
  return formatMediaLabel(value, "Anime");
}

function messageFrom(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

function formatPlaybackTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
