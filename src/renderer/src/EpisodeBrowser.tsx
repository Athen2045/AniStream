import { sameEpisode } from "./anime-episode-list";
import { Check, ChevronDown, Clock3, Play } from "lucide-react";
import { useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeRange,
  AnimeEpisodeRanges,
  AnimeProviderEpisode,
  AnimeProviderSeason,
  PlaybackResume,
} from "../../shared/contracts";
import {
  airedEpisodeCount,
  episodeAiringLabel,
  episodeRangesLabel,
  missingAiredEpisodes,
  unairedEpisode,
} from "./airing";
import { EpisodeQueueToggle } from "./UpNextButton";
import { EpisodeDownloadToggle } from "./DownloadButtons";
import { useOptionalDownloads } from "./DownloadsProvider";
import { useOnline } from "./useOnline";
import { cachedArtworkUrl } from "../../shared/artwork";
import { downloadKey } from "../../shared/downloads";
import { animeBingeItem } from "./binge-session";
import { isSeasonEntry } from "./anime-season-chain";
import { SeasonPicker, mediaFormatLabel } from "./SeasonPicker";

const EPISODES_PAGE_SIZE = 12;
export function EpisodeBrowser({
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
  // Offline, a title with downloads lists just those: the episodes that can play now.
  const isDownloaded = (episode: AnimeProviderEpisode): boolean =>
    downloads?.byEpisode.get(downloadKey(media.id, episode.number))?.status === "done";
  const downloadedOnly = !online && seasonEpisodes.some(isDownloaded);
  // The last range also holds the locked next-airing tile past the aired count.
  const episodes = downloadedOnly
    ? seasonEpisodes.filter(isDownloaded)
    : shownRange
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
            {downloadedOnly
              ? `Downloaded · ${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`
              : shownRange
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
      {online && !loading && missing.length ? (
        <p className="provider-note" role="status">
          {missing.length > 1
            ? `Episodes ${episodeRangesLabel(missing)} have aired, but the source hasn't added them yet.`
            : `Episode ${missing[0]} has aired, but the source hasn't added it yet.`}
        </p>
      ) : null}
      {/* Offline, the page's own offline note says it; a source error would only confuse. */}
      {online && providerMessage ? (
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

/** An image that cannot load (e.g. offline and never cached) disappears instead of showing broken. */
function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.visibility = "hidden";
}
