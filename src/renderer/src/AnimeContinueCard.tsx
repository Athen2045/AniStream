import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { cachedArtworkUrl } from "../../shared/artwork";
import type { AniListCatalogMedia, AnimeEpisodeArt } from "../../shared/contracts";
import type { ContinueTitle } from "../../shared/personal-library";
import { ContinueRemoveButton } from "./ContinueRemoveButton";
import { CoverImage } from "./CoverImage";

/**
 * Continue Watching card (redesign 2026-10-18, after the user's reference): the next episode's
 * own still with a thin progress line, then its name and "Episode 2 / 12 · show", with the length
 * on the right. The still and name come from the episode-art sources (saved with the title, so
 * they show offline too); the series banner stands in until they arrive. Without either (older
 * history has no banner), the poster sits whole on a blurred copy of itself instead of being
 * cropped. A round More info button beside the name opens the title page (2026-10-19).
 */
export function AnimeContinueCard({
  item,
  onPlay,
  onSelect,
}: {
  item: ContinueTitle;
  onPlay: (media: AniListCatalogMedia, episode: number) => void;
  onSelect: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const media = { ...item.media, genres: item.media.genres ?? [] };
  const episode = item.targetUnit;
  const art = useEpisodeArt(media.id, media.totalProgress ?? episode, episode);
  const resume = item.local?.playbackResume;
  const resumed =
    resume && resume.episode === episode && resume.durationSeconds > 0 ? resume : undefined;
  const share = resumed ? Math.min(1, resumed.positionSeconds / resumed.durationSeconds) : 0;
  const minutes = resumed ? Math.round(resumed.durationSeconds / 60) : undefined;
  const wide = art?.stillUrl ?? (media.bannerUrl ? cachedArtworkUrl(media.bannerUrl) : undefined);
  const poster = wide ? undefined : cachedArtworkUrl(media.coverUrl);
  // A film is one piece: its own title, then "Movie · 1h 21m left" (no episode numbers).
  const movie = media.format === "MOVIE";
  const name = movie ? media.title : art?.title?.trim() || `Episode ${episode}`;
  const left = resumed
    ? Math.max(1, Math.round((resumed.durationSeconds - resumed.positionSeconds) / 60))
    : undefined;
  return (
    <article className="rail-card anime-continue-card">
      <span className={`anime-continue-art${poster ? " is-poster" : ""}`}>
        <button
          type="button"
          className="rail-art-hit"
          onClick={() => onPlay(media, episode)}
          aria-label={`Play episode ${episode} of ${media.title}: ${name}`}
        />
        {poster ? (
          <>
            <img className="anime-continue-blur" src={poster} alt="" aria-hidden="true" />
            <CoverImage src={poster} title={media.title} className="anime-continue-poster" />
          </>
        ) : (
          <CoverImage src={wide} title={media.title} />
        )}
        {share > 0 ? (
          <span className="anime-continue-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${share})` }} />
          </span>
        ) : null}
        <ContinueRemoveButton section="ANIME" id={media.id} title={media.title} />
      </span>
      <span className="anime-continue-head">
        <button
          type="button"
          className="anime-continue-name"
          title={name}
          onClick={() => onPlay(media, episode)}
        >
          {name}
        </button>
        <button
          type="button"
          className="anime-continue-info"
          onClick={() => onSelect(media)}
          aria-label={`More info about ${media.title}`}
          data-tooltip="More info"
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </span>
      <span className="anime-continue-line">
        <span className="anime-continue-where">
          {movie ? (
            <>
              <b>Movie</b>
              {left ? (
                <>
                  <span aria-hidden="true"> · </span>
                  {left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m` : `${left} min`} left
                </>
              ) : null}
            </>
          ) : (
            <>
              <b>Episode {episode}</b>
              {media.totalProgress ? ` / ${media.totalProgress}` : ""}
              <span aria-hidden="true"> · </span>
              <button type="button" onClick={() => onSelect(media)} title={`About ${media.title}`}>
                {media.title}
              </button>
            </>
          )}
        </span>
        {minutes ? <span className="anime-continue-time">{minutes}m</span> : null}
      </span>
    </article>
  );
}

/** One episode's art, for a Continue card; undefined until (and unless) it loads. */
function useEpisodeArt(
  aniListId: number,
  episodes: number,
  episode: number,
): AnimeEpisodeArt | undefined {
  const [art, setArt] = useState<{ key: string; value?: AnimeEpisodeArt }>();
  const key = `${aniListId}:${episode}`;
  useEffect(() => {
    let active = true;
    window.anistream
      .getAnimeEpisodeArt({ aniListId, episodes: Math.max(episodes, episode), focus: episode })
      .then((rows) => {
        if (active) setArt({ key, value: rows.find((row) => row.number === episode) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [aniListId, episode, episodes, key]);
  return art?.key === key ? art.value : undefined;
}
