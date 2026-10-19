import { Clapperboard, Clock3, Play } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cachedArtworkUrl } from "../../shared/artwork";
import type { AniListCatalogMedia, PlaybackResume } from "../../shared/contracts";

export interface AnimeTitleScore {
  score: string;
  source: string;
  href?: string;
  title?: string;
}

/**
 * The top of an anime title page (redesign 2026-10-18). Two layouts, so a film never looks like
 * a series (user decision: AniList's MOVIE format is a film; one-episode OVAs and specials stay
 * series):
 * - series: wide artwork with one line of details, title, scores and genres, a short summary,
 *   and the actions; the episodes follow below;
 * - movie: the artwork fills the window behind a left column with a "Movie" badge, runtime,
 *   summary, how much is left, Play/Resume and its facts; there is no episode list.
 */
export function AnimeTitleHeader({
  media,
  layout,
  kicker,
  scores,
  genres,
  description,
  loading,
  primaryLabel,
  blockedLabel,
  onPrimary,
  actions,
  extra,
  facts,
  minutes,
  studio,
}: {
  media: AniListCatalogMedia;
  layout: "series" | "movie";
  kicker: string[];
  scores: AnimeTitleScore[];
  genres: string[];
  description?: string;
  loading: boolean;
  primaryLabel: string;
  blockedLabel?: string;
  onPrimary: () => void;
  /** Secondary buttons after the primary one (download, list, Up Next, rating, feedback). */
  actions: ReactNode;
  /** Under the actions: the rating panel, source credits, errors. */
  extra?: ReactNode;
  /** Movies show their facts in the header (series list them in About below). */
  facts?: Array<[string, string]>;
  /** Runtime in minutes, for a movie's "2h 10m". */
  minutes?: number;
  studio?: string;
}): React.JSX.Element {
  const [failedArt, setFailedArt] = useState<string>();
  const [open, setOpen] = useState(false);
  const movie = layout === "movie";
  const resume = useMovieResume(movie ? media.id : undefined);
  const banner = media.bannerUrl && media.bannerUrl !== failedArt ? media.bannerUrl : undefined;
  const art = banner ?? media.coverUrl;
  // Part-way through a film: "Resume movie" and how much is left.
  const partway =
    resume &&
    resume.durationSeconds > 0 &&
    resume.positionSeconds > 30 &&
    resume.durationSeconds - resume.positionSeconds > 60
      ? {
          share: Math.min(1, resume.positionSeconds / resume.durationSeconds),
          leftMinutes: Math.round((resume.durationSeconds - resume.positionSeconds) / 60),
        }
      : undefined;
  const label = movie ? (partway ? "Resume movie" : "Play movie") : primaryLabel;

  return (
    <header className={`anime-head anime-head--${layout}${banner ? "" : " anime-head--cover"}`}>
      <div className="anime-head-art" aria-hidden="true">
        {art ? (
          <img
            src={cachedArtworkUrl(art)}
            alt=""
            decoding="async"
            fetchPriority="high"
            onError={() => setFailedArt(media.bannerUrl)}
          />
        ) : null}
      </div>
      <div className="anime-head-copy">
        {movie ? (
          <span className="anime-head-badge">
            <Clapperboard size={13} strokeWidth={2.2} aria-hidden="true" />
            Movie
          </span>
        ) : (
          <p className="anime-head-kicker">
            {kicker.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </p>
        )}
        <h1>{media.title}</h1>
        <p className="anime-head-meta">
          {movie ? (
            <>
              {media.seasonYear ? <b>{media.seasonYear}</b> : null}
              {minutes ? <b>{runtime(minutes)}</b> : null}
              {studio ? <span>{studio}</span> : null}
            </>
          ) : null}
          {scores.map((score) => (
            <span key={score.source} className="anime-head-score" title={score.title}>
              {score.href ? (
                <a href={score.href} target="_blank" rel="noreferrer">
                  <b>{score.score}</b> {score.source}
                </a>
              ) : (
                <>
                  <b>{score.score}</b> {score.source}
                </>
              )}
            </span>
          ))}
          {genres.length && !movie ? <span>{genres.slice(0, 3).join(", ")}</span> : null}
        </p>
        {movie && genres.length ? (
          <p className="anime-head-genres">{genres.slice(0, 3).join(", ")}</p>
        ) : null}
        {loading && !description ? (
          <div className="anime-head-synopsis-loading" aria-hidden="true">
            <span className="sk-line" style={{ width: "92%" }} />
            <span className="sk-line" style={{ width: "70%" }} />
          </div>
        ) : description ? (
          <p
            className={`anime-head-synopsis${open ? " is-open" : ""}`}
            onClick={() => setOpen((value) => !value)}
            title={open ? undefined : "Show the whole summary"}
          >
            {description}
          </p>
        ) : null}
        {movie && partway ? (
          <div className="anime-head-resume">
            <span className="anime-head-resume-track" aria-hidden="true">
              <span style={{ transform: `scaleX(${partway.share})` }} />
            </span>
            {runtime(partway.leftMinutes)} left
          </div>
        ) : null}
        <div className="anime-head-actions">
          <button
            className={`anime-head-primary${blockedLabel ? " is-upcoming" : ""}`}
            type="button"
            disabled={Boolean(blockedLabel)}
            onClick={onPrimary}
          >
            {blockedLabel ? (
              <Clock3 size={18} aria-hidden="true" />
            ) : (
              <Play size={18} fill="currentColor" aria-hidden="true" />
            )}
            {blockedLabel ?? label}
          </button>
          {actions}
        </div>
        {extra}
        {movie && facts?.length ? (
          <dl className="anime-head-facts">
            {facts.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  );
}

/** Series: Status, Aired, Studio and Original creator in one quiet strip below the episodes. */
export function AnimeAbout({ facts }: { facts: Array<[string, string]> }): React.JSX.Element {
  return (
    <section className="title-section anime-about" data-title-section="about">
      <h2>About</h2>
      <dl>
        {facts.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Where the viewer stopped in a film (the saved episode-1 position). */
function useMovieResume(aniListId: number | undefined): PlaybackResume | undefined {
  const [resume, setResume] = useState<{ id: number; value?: PlaybackResume }>();
  useEffect(() => {
    if (!aniListId) return;
    let active = true;
    window.anistream
      .getPlaybackResume(aniListId)
      .then((value) => {
        if (active) setResume({ id: aniListId, value: value ?? undefined });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [aniListId]);
  return resume && resume.id === aniListId ? resume.value : undefined;
}

function runtime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}
