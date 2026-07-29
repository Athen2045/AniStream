import "@videojs/react/video/skin.css";
import { createPlayer } from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { VideoSkin, videoFeatures } from "@videojs/react/video";
import { ChevronDown, ChevronLeft, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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

const VideoJsPlayer = createPlayer({ features: videoFeatures });
const PLAYER_ENTER_DURATION_MS = 420;
const PLAYER_ENTER_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// Remembered across episodes/sources for the whole session so switching episodes
// doesn't reset the user's chosen volume.
let sessionVolume = 0.8;

type WatchView = "episodes" | "player";

export function AnimeWatchExperience({
  media,
  initialEpisode,
  onEpisodeWatched,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  initialEpisode: number;
  onEpisodeWatched: (episode: number) => Promise<void>;
}): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
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
  const allEpisodes = seasons.flatMap((season) => season.episodes);
  const activeIndex = allEpisodes.findIndex((episode) => sameEpisode(episode, activeEpisode));
  const nextEpisode =
    activeIndex >= 0 && activeIndex + 1 < allEpisodes.length
      ? allEpisodes[activeIndex + 1]
      : undefined;
  const hlsSources = playback?.candidates.filter((candidate) => candidate.kind === "hls") ?? [];
  const torrents = playback?.candidates.filter((candidate) => candidate.kind === "torrent") ?? [];
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
        totalEpisodes: media.totalProgress,
      }),
      window.anistream.getPlaybackResume(media.id),
    ]).then(([catalogResult, resumeResult]) => {
      if (!active) return;

      const nextCatalog =
        catalogResult.status === "fulfilled"
          ? catalogResult.value
          : {
              status: "unavailable" as const,
              provider: "aniwatch" as const,
              seasons: [],
              message: messageFrom(catalogResult.reason, "Aniwatch episode data is unavailable."),
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
    media.id,
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
        setSource(result.candidates.find((candidate) => candidate.kind === "hls"));
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

  const animatePlayerEntry = useCallback((): void => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const playerView = rootRef.current?.querySelector<HTMLElement>(".watch-player-view");
    const animation = playerView?.animate(
      [
        { opacity: 0, transform: "translate3d(0, 18px, 0) scale(0.965)" },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ],
      {
        duration: PLAYER_ENTER_DURATION_MS,
        easing: PLAYER_ENTER_EASING,
        fill: "both",
      },
    );
    void animation?.finished.finally(() => animation.cancel());
  }, []);

  const playEpisode = useCallback(
    (episode: AnimeProviderEpisode, requestFullscreen: boolean): void => {
      const root = rootRef.current;
      if (requestFullscreen && root && !document.fullscreenElement) {
        void root.requestFullscreen().catch(() => undefined);
      }

      flushSync(() => {
        setResume((current) => (current?.episode === episode.number ? current : undefined));
        setLoadingPlayback(true);
        setPlayback(undefined);
        setSource(undefined);
        setError(undefined);
        setActiveEpisode(episode);
        setSelectedSeasonId(seasonContainingEpisode(seasons, episode)?.id ?? selectedSeasonId);
        setView("player");
      });
      animatePlayerEntry();
    },
    [animatePlayerEntry, seasons, selectedSeasonId],
  );

  const returnToEpisodes = useCallback((): void => {
    setView("episodes");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  return (
    <section
      ref={rootRef}
      className={`watch-experience watch-experience--${view}`}
      aria-label={`${media.title} episodes and player`}
    >
      {view === "episodes" ? (
        <EpisodeBrowser
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
        <div className="watch-player-view">
          <button
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
            <AniStreamVideo
              key={`${activeEpisode.number}:${source.id}`}
              mediaId={media.id}
              episode={activeEpisode}
              source={source}
              poster={activeEpisode.thumbnailUrl ?? media.bannerUrl ?? media.coverUrl}
              resume={resume?.episode === activeEpisode.number ? resume : undefined}
              nextEpisode={nextEpisode}
              onNext={(episode) => playEpisode(episode, false)}
              onWatched={onEpisodeWatched}
              onError={setError}
            />
          ) : (
            <div className="player-unavailable" role="status">
              <Play size={54} />
              <h3>{loadingPlayback ? "Finding a stream…" : "HLS source unavailable"}</h3>
              <p>
                {loadingPlayback
                  ? "Checking the approved AniWatch hosters and preparing adaptive playback."
                  : (playback?.message ??
                    "The provider returned no playable HLS variant for this episode.")}
              </p>
              {torrents.length ? <TorrentFallback candidates={torrents} /> : null}
            </div>
          )}

          {error ? <p className="watch-player-error">{error}</p> : null}

          {hlsSources.length > 1 ? (
            <label className="watch-source-select">
              <span>Stream</span>
              <select
                aria-label="Video stream"
                value={source?.id ?? ""}
                onChange={(event) => {
                  const selected = hlsSources.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  if (selected) setSource(selected);
                }}
              >
                {hlsSources.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.quality ?? candidate.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}
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
        {(activeSeason?.episodes ?? []).map((episode) => {
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
                {episode.thumbnailUrl ? (
                  <img src={episode.thumbnailUrl} alt="" loading="lazy" />
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
    </div>
  );
}

function AniStreamVideo({
  mediaId,
  episode,
  source,
  poster,
  resume,
  nextEpisode,
  onNext,
  onWatched,
  onError,
}: {
  mediaId: number;
  episode: AnimeProviderEpisode;
  source: AnimePlaybackCandidate;
  poster: string;
  resume?: PlaybackResume;
  nextEpisode?: AnimeProviderEpisode;
  onNext: (episode: AnimeProviderEpisode) => void;
  onWatched: (episode: number) => Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const markedRef = useRef(false);
  const lastSavedAt = useRef(0);
  const [ended, setEnded] = useState(false);

  const saveResume = useCallback(
    (force = false): void => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const now = Date.now();
      if (!force && now - lastSavedAt.current < 10_000) return;
      lastSavedAt.current = now;
      void window.anistream.savePlaybackResume({
        aniListId: mediaId,
        episode: episode.number,
        positionSeconds: Math.max(0, video.currentTime),
        durationSeconds: video.duration,
      });
    },
    [episode.number, mediaId],
  );

  useEffect(() => () => saveResume(true), [saveResume]);

  const updateProgress = (video: HTMLVideoElement): void => {
    saveResume();
    if (
      !markedRef.current &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime / video.duration >= 0.9
    ) {
      markedRef.current = true;
      void onWatched(episode.number);
    }
  };

  const completeEpisode = (): void => {
    markedRef.current = true;
    setEnded(true);
    void window.anistream.clearPlaybackResume(mediaId);
    void onWatched(episode.number);
  };

  return (
    <div className="anistream-player">
      <VideoJsPlayer.Provider>
        <VideoSkin className="anistream-videojs" poster={poster}>
          <HlsJsVideo
            ref={videoRef}
            src={source.url}
            autoPlay
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.volume = sessionVolume;
              if (resume && resume.positionSeconds < video.duration - 20) {
                video.currentTime = resume.positionSeconds;
              }
              void video.play().catch(() => undefined);
            }}
            onVolumeChange={(event) => {
              sessionVolume = event.currentTarget.volume;
            }}
            onPause={() => saveResume(true)}
            onTimeUpdate={(event) => updateProgress(event.currentTarget)}
            onEnded={completeEpisode}
            onError={() => onError("The selected HLS stream could not be played.")}
          >
            {source.subtitles?.map((track) => (
              <track
                key={track.url}
                kind="subtitles"
                label={track.label}
                srcLang={track.language ?? "en"}
                src={track.url}
              />
            ))}
          </HlsJsVideo>
        </VideoSkin>
      </VideoJsPlayer.Provider>

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

function TorrentFallback({
  candidates,
}: {
  candidates: AnimePlaybackCandidate[];
}): React.JSX.Element {
  return (
    <details className="torrent-fallback">
      <summary>Use torrent fallback ({candidates.length})</summary>
      <p>
        AniStream opens the selected magnet in your installed torrent client. It does not download
        or seed media itself.
      </p>
      <div className="torrent-list">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => void window.anistream.openTorrentMagnet(candidate.url)}
          >
            <strong>{candidate.label}</strong>
            <span>
              {candidate.quality ?? "release"}
              {candidate.seeders !== undefined ? ` · ${candidate.seeders} seeders` : ""}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function fallbackSeason(media: AniListCatalogMedia | AniListMediaDetail): AnimeProviderSeason {
  const count = Math.min(Math.max(media.totalProgress ?? 1, 1), 500);
  return {
    id: `anilist:${media.id}`,
    number: 1,
    title: "Season 1",
    episodes: Array.from({ length: count }, (_, index) => ({
      id: "",
      number: index + 1,
      title: `Episode ${index + 1}`,
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
  return text || undefined;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").toLocaleLowerCase();
}

function messageFrom(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
