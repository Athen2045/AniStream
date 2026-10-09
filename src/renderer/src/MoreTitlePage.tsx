import { ArrowDownUp, ArrowLeft, Check, Play } from "lucide-react";
import { RatingChips, compactVotes } from "./RatingChips";
import { useSimklStatus } from "./profile-look";
import { MoreRating } from "./MoreRating";
import { MoreSaveMenu } from "./MoreSaveMenu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MoreCatalogItem,
  MoreDetail,
  MoreSeasonDetail,
  MoreTitleProgress,
  MoreMediaType,
  MoreTitleStatusAction,
  SimklTitleRatings,
} from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { CoverImage } from "./CoverImage";
import { SimilarTitles } from "./SimilarTitles";
import { MoreTitleArt } from "./MoreHero";
import { MoreWatchExperience } from "./MoreWatchExperience";
import { ReleasePill } from "./ReleasePill";
import {
  episodeLabel,
  formatDuration,
  formatLongDate,
  formatRemaining,
  formatScore,
  formatShortDate,
  isFinished,
  isUpcoming,
  moreKey,
  moreSnapshot,
  progressRatio,
  releaseState,
  resumeTarget,
  type MorePlayTarget,
} from "./more-format";
import { friendlyRemoteError } from "./remote-error";
import { Select } from "./Select";
import { EpisodeQueueToggle, UpNextButton } from "./UpNextButton";
import { moreBingeItem } from "./binge-session";
import type { NextUp } from "./AutoplayNext";
import { TitleFeedback } from "./TitleFeedback";

type Playing = { kind: "movie" } | ({ kind: "episode" } & MorePlayTarget);

/** Full-page TMDB title view: artwork, facts, and (for shows) a season's episode grid. */
export function MoreTitlePage({
  item,
  initialAction,
  initialTarget,
  saved,
  completed,
  onSetStatus,
  onBack,
  backLabel = "More",
  onProgressChanged,
  onOpenTitle,
}: {
  item: MoreCatalogItem;
  initialAction: "details" | "play";
  /** An exact episode to start (from Up Next) instead of the resume target. */
  initialTarget?: MorePlayTarget;
  saved: boolean;
  completed: boolean;
  onSetStatus: (item: MoreCatalogItem, action: MoreTitleStatusAction) => void;
  onBack: () => void;
  backLabel?: string;
  onProgressChanged: () => void;
  /** Opens another title's page (from "More like this"). */
  onOpenTitle?: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const [detail, setDetail] = useState<MoreDetail>();
  const [detailError, setDetailError] = useState<string>();
  const [progress, setProgress] = useState<MoreTitleProgress[]>();
  const [chosenSeason, setSeason] = useState<number>();
  const [seasonState, setSeasonState] = useState<{
    season: number;
    detail?: MoreSeasonDetail;
    error?: string;
  }>();
  const [newestFirst, setNewestFirst] = useState(false);
  const [playing, setPlaying] = useState<Playing>();
  const autoPlay = useRef(initialAction === "play");

  useEffect(() => {
    let active = true;
    void window.anistream
      .getMoreDetail(item.id, item.type)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((reason: unknown) => {
        if (active)
          setDetailError(
            friendlyRemoteError(reason, {
              provider: "TMDB",
              operation: "title details",
              fallback: "Title details are unavailable right now.",
            }),
          );
      });
    return () => {
      active = false;
    };
  }, [item.id, item.type]);

  const loadProgress = useCallback(() => {
    void window.anistream
      .getMoreTitleProgress({ tmdbId: item.id, type: item.type })
      .then(setProgress)
      .catch(() => setProgress([]));
  }, [item.id, item.type]);
  useEffect(loadProgress, [loadProgress]);

  const resume = useMemo(
    () => (progress ? resumeTarget(detail, progress) : undefined),
    [detail, progress],
  );
  // Without details, a show's resume target is unknown; a movie only needs its progress.
  const ready = Boolean(resume && (item.type === "MOVIE" || detail));
  const release = releaseState(detail?.releaseDate ?? item.releaseDate, detail?.status);

  // Open on the season being watched, else the first regular season.
  const season =
    chosenSeason ??
    (detail?.type === "TV" && resume
      ? (resume.target?.season ?? detail.seasons.find((s) => s.number > 0)?.number ?? 1)
      : undefined);
  const seasonDetail = seasonState?.season === season ? seasonState?.detail : undefined;
  const seasonError = seasonState?.season === season ? seasonState?.error : undefined;

  useEffect(() => {
    if (season === undefined) return;
    let active = true;
    void window.anistream
      .getMoreSeason(item.id, season)
      .then((next) => {
        if (active) setSeasonState({ season, detail: next });
      })
      .catch((reason: unknown) => {
        if (active)
          setSeasonState({
            season,
            error: friendlyRemoteError(reason, {
              provider: "TMDB",
              operation: "episode list",
              fallback: "Episodes are unavailable right now.",
            }),
          });
      });
    return () => {
      active = false;
    };
  }, [item.id, season]);

  const play = useCallback(
    (target?: MorePlayTarget) => {
      void window.anistream.rememberMoreTitle(moreSnapshot(detail ?? item)).catch(() => undefined);
      setPlaying(
        item.type === "MOVIE"
          ? { kind: "movie" }
          : { kind: "episode", ...(target ?? resume?.target ?? { season: 1, episode: 1 }) },
      );
    },
    [detail, item, resume?.target],
  );

  // Auto-play waits for details so the release check can see TMDB's status for undated titles.
  useEffect(() => {
    if (!autoPlay.current || !ready || !detail) return;
    // Opening an unreleased title from a Play shortcut lands on its page instead.
    if (release.unreleased) {
      autoPlay.current = false;
      return;
    }
    // The flag flips only when playback actually starts, so a StrictMode re-run still plays.
    const start = window.setTimeout(() => {
      autoPlay.current = false;
      play(initialTarget);
    }, 0);
    return () => window.clearTimeout(start);
  }, [detail, initialTarget, play, ready, release.unreleased]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !playing) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, playing]);

  const progressByEpisode = useMemo(() => {
    const map = new Map<string, MoreTitleProgress>();
    for (const entry of progress ?? [])
      if (entry.season && entry.episode) map.set(`${entry.season}:${entry.episode}`, entry);
    return map;
  }, [progress]);

  const view = detail ?? item;
  const simklRatings = useSimklTitleRatings(item.id, item.type);
  const backdrop = detail?.heroBackdropUrl ?? item.backdropUrl ?? item.posterUrl;
  const score = formatScore(view.score);
  const regularSeasons = detail?.seasons.filter((candidate) => candidate.number > 0) ?? [];
  const episodes = useMemo(() => {
    const list = seasonDetail?.episodes ?? [];
    return newestFirst ? [...list].reverse() : list;
  }, [newestFirst, seasonDetail]);
  const target = resume?.target;
  const targetEpisode =
    target && seasonDetail?.seasonNumber === target.season
      ? seasonDetail.episodes.find((episode) => episode.number === target.episode)
      : undefined;
  const upcomingTarget =
    target && targetEpisode && isUpcoming(targetEpisode.airDate) && targetEpisode.airDate
      ? { ...target, label: `Airs ${formatShortDate(targetEpisode.airDate)}` }
      : undefined;
  const primaryLabel =
    item.type === "MOVIE"
      ? resume?.mode === "resume"
        ? "Resume"
        : "Play"
      : target
        ? `${resume?.mode === "resume" ? "Resume" : "Play"} ${episodeLabel(target.season, target.episode)}`
        : "Play";

  // The next aired episode in the playing season (from the loaded season list) autoplays next;
  // after a season's last episode, Up Next takes over.
  const playingEpisode = playing?.kind === "episode" ? playing : undefined;
  const followingEpisode =
    playingEpisode && seasonDetail?.seasonNumber === playingEpisode.season
      ? seasonDetail.episodes.find(
          (candidate) =>
            candidate.number === playingEpisode.episode + 1 && !isUpcoming(candidate.airDate),
        )
      : undefined;
  const nextEpisode: NextUp | undefined =
    playingEpisode && followingEpisode
      ? {
          heading: "Next episode",
          title: `${episodeLabel(playingEpisode.season, followingEpisode.number)} · ${followingEpisode.name}`,
          play: () =>
            setPlaying({
              kind: "episode",
              season: playingEpisode.season,
              episode: followingEpisode.number,
            }),
        }
      : undefined;
  const currentKeys = [
    `more:${item.type}:${item.id}`,
    ...(playingEpisode
      ? [`more:${item.type}:${item.id}:s${playingEpisode.season}e${playingEpisode.episode}`]
      : []),
  ];

  const facts: Array<[string, string]> = [];
  if (detail?.status) facts.push(["Status", detail.status]);
  if (detail?.originalLanguage) facts.push(["Language", detail.originalLanguage.toUpperCase()]);
  const released = formatLongDate(view.releaseDate);
  if (released)
    facts.push([
      item.type === "MOVIE"
        ? release.unreleased
          ? "Release date"
          : "Released"
        : release.unreleased
          ? "Premieres"
          : "First aired",
      released,
    ]);
  const lastAired = formatLongDate(detail?.lastAirDate);
  if (lastAired) facts.push(["Last aired", lastAired]);
  if (item.type === "MOVIE" && detail?.runtimeMinutes)
    facts.push(["Runtime", formatDuration(detail.runtimeMinutes)]);
  if (item.type === "TV" && detail?.numberOfSeasons)
    facts.push(["Seasons", String(detail.numberOfSeasons)]);
  if (item.type === "TV" && detail?.numberOfEpisodes)
    facts.push(["Episodes", String(detail.numberOfEpisodes)]);

  return (
    <section className="more-title-page" aria-label={`${view.title} details`}>
      {playing ? (
        <MoreWatchExperience
          key={playing.kind === "episode" ? `${playing.season}:${playing.episode}` : "movie"}
          next={nextEpisode}
          currentKeys={currentKeys}
          item={view}
          season={playing.kind === "episode" ? playing.season : 1}
          episode={playing.kind === "episode" ? playing.episode : 1}
          onClose={() => {
            setPlaying(undefined);
            loadProgress();
            onProgressChanged();
          }}
        />
      ) : null}
      <header className="more-title-hero">
        {backdrop ? (
          <img className="more-hero-art" src={backdrop} alt="" aria-hidden="true" />
        ) : null}
        <div className="more-hero-shade more-hero-shade--detail" aria-hidden="true" />
        <div className="more-hero-top">
          <button className="more-back" type="button" onClick={onBack}>
            <ArrowLeft size={17} aria-hidden="true" /> {backLabel}
          </button>
        </div>
        <div className="more-title-copy">
          <MoreTitleArt title={view.title} logoUrl={detail?.logoUrl} level={1} />
          {detail?.genres.length ? (
            <p className="more-genres">
              {detail.genres.slice(0, 3).map((genre) => (
                <span key={genre}>{genre}</span>
              ))}
            </p>
          ) : null}
          <div className="more-actions">
            {release.unreleased ? (
              <ReleasePill label={release.label} />
            ) : upcomingTarget ? (
              <ReleasePill
                heading={`${episodeLabel(upcomingTarget.season, upcomingTarget.episode)} airs soon`}
                label={upcomingTarget.label}
              />
            ) : (
              <button
                className="more-btn-play"
                type="button"
                disabled={!ready}
                onClick={() => play()}
              >
                <Play size={20} fill="currentColor" /> {primaryLabel}
              </button>
            )}
            <MoreSaveMenu
              title={view.title}
              className="more-btn-round"
              iconSize={20}
              saved={saved}
              completed={completed}
              onAction={(action) => onSetStatus(view, action)}
            />
            <UpNextButton item={moreBingeItem(view)} className="more-btn-upnext" />
            <TitleFeedback
              title={view.title}
              target={{ type: view.type, id: view.id }}
              className="more-btn-round"
            />
          </div>
          <div className="more-facts">
            {view.year ? <span>{view.year}</span> : null}
            {detail?.certification ? (
              <span className="more-cert">{detail.certification}</span>
            ) : null}
            {item.type === "MOVIE" && detail?.runtimeMinutes ? (
              <span>{formatDuration(detail.runtimeMinutes)}</span>
            ) : null}
          </div>
          {detail?.creators.length ? (
            <p className="more-credits">
              Created by <strong>{detail.creators.join(", ")}</strong>
            </p>
          ) : null}
          <RatingChips
            chips={[
              score
                ? {
                    source: "tmdb",
                    score,
                    detail: view.voteCount ? `${compactVotes(view.voteCount)} votes` : "TMDB",
                    href: view.siteUrl,
                    title: `${score}/10 on TMDB`,
                  }
                : undefined,
              simklRatings?.imdb && simklRatings.imdbUrl
                ? {
                    source: "imdb",
                    score: simklRatings.imdb.rating.toFixed(1),
                    detail: simklRatings.imdb.votes
                      ? compactVotes(simklRatings.imdb.votes)
                      : "IMDb",
                    href: simklRatings.imdbUrl,
                    title: `${simklRatings.imdb.rating.toFixed(1)}/10 on IMDb (via Simkl)`,
                  }
                : undefined,
              simklRatings?.simkl
                ? {
                    source: "simkl",
                    score: simklRatings.simkl.rating.toFixed(1),
                    detail: "Simkl",
                    href: simklRatings.simklUrl,
                    title: `${simklRatings.simkl.rating.toFixed(1)}/10 on Simkl`,
                  }
                : undefined,
            ]}
          />
          <MoreRating item={view} completed={completed} />
          <p className="more-title-overview">{view.overview ?? "No synopsis is available."}</p>
          {detailError ? <p className="error-banner">{detailError}</p> : null}
        </div>
        {facts.length || detail?.brandName ? (
          <aside className="more-info-card" aria-label="Title facts">
            {facts.length ? (
              <dl>
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {detail?.brandLogoUrl ? (
              <img className="more-brand" src={detail.brandLogoUrl} alt={detail.brandName ?? ""} />
            ) : detail?.brandName ? (
              <span className="more-brand-text">{detail.brandName}</span>
            ) : null}
          </aside>
        ) : null}
      </header>

      {item.type === "TV" ? (
        <section className="more-episodes" aria-label="Episodes">
          <div className="more-episodes-head">
            <h2>Episodes</h2>
            <div className="more-episodes-tools">
              <button
                className="more-chip"
                type="button"
                aria-pressed={newestFirst}
                onClick={() => setNewestFirst((value) => !value)}
              >
                <ArrowDownUp size={15} aria-hidden="true" /> {newestFirst ? "Newest" : "Oldest"}
              </button>
              {regularSeasons.length ? (
                <Select
                  className="more-chip more-chip--select"
                  ariaLabel="Season"
                  value={String(season ?? "")}
                  options={regularSeasons.map((candidate) => ({
                    value: String(candidate.number),
                    label: candidate.name,
                  }))}
                  onChange={(next) => setSeason(Number(next))}
                />
              ) : null}
            </div>
          </div>
          {seasonError ? <p className="error-banner">{seasonError}</p> : null}
          <div className="more-episode-grid">
            {seasonDetail
              ? episodes.map((episode) => {
                  const entry = progressByEpisode.get(
                    `${seasonDetail.seasonNumber}:${episode.number}`,
                  );
                  const watched = entry ? isFinished(entry) : false;
                  const upcoming = release.unreleased || isUpcoming(episode.airDate);
                  const current =
                    target?.season === seasonDetail.seasonNumber &&
                    target.episode === episode.number;
                  return (
                    <article
                      key={episode.number}
                      className={`more-episode${watched ? " watched" : ""}${current ? " current" : ""}${upcoming ? " upcoming" : ""}`}
                    >
                      <button
                        className="more-episode-art"
                        type="button"
                        disabled={upcoming}
                        aria-label={
                          upcoming
                            ? `Episode ${episode.number}, ${episode.name}, not aired yet`
                            : `Play episode ${episode.number}, ${episode.name}`
                        }
                        onClick={() =>
                          play({ season: seasonDetail.seasonNumber, episode: episode.number })
                        }
                      >
                        <CoverImage
                          src={episode.stillUrl ?? item.backdropUrl}
                          title={episode.name}
                        />
                        <span className="more-episode-num">E{episode.number}</span>
                        {watched ? (
                          <span className="more-episode-check" aria-label="Watched">
                            <Check size={14} strokeWidth={3} />
                          </span>
                        ) : null}
                        {entry && !watched ? (
                          <span className="more-episode-time">{formatRemaining(entry)}</span>
                        ) : episode.runtimeMinutes ? (
                          <span className="more-episode-time">
                            {formatDuration(episode.runtimeMinutes)}
                          </span>
                        ) : null}
                        <span className="more-episode-play" aria-hidden="true">
                          <Play size={22} fill="currentColor" />
                        </span>
                        {entry ? (
                          <span className="more-progress" aria-hidden="true">
                            <span style={{ width: `${Math.round(progressRatio(entry) * 100)}%` }} />
                          </span>
                        ) : null}
                      </button>
                      {upcoming ? null : (
                        <EpisodeQueueToggle
                          item={moreBingeItem(view, seasonDetail.seasonNumber, episode.number)}
                          label={episodeLabel(seasonDetail.seasonNumber, episode.number)}
                        />
                      )}
                      <h3>{episode.name}</h3>
                      {upcoming ? (
                        <p className="more-episode-now more-episode-airs">
                          {episode.airDate
                            ? `Airs ${formatShortDate(episode.airDate)}`
                            : "Air date not announced"}
                        </p>
                      ) : current && resume?.mode !== "start" ? (
                        <p className="more-episode-now">
                          {resume?.mode === "resume" ? "Continue watching" : "Up next"}
                        </p>
                      ) : episode.overview ? (
                        <p>{episode.overview}</p>
                      ) : null}
                    </article>
                  );
                })
              : !seasonError
                ? Array.from({ length: 8 }, (_, position) => (
                    <div
                      key={position}
                      className="more-episode more-episode--skeleton"
                      aria-hidden="true"
                    >
                      <span className="more-episode-art" />
                    </div>
                  ))
                : null}
          </div>
        </section>
      ) : null}

      {/* Below Play (movies) or the episodes (shows): Cast, then More like this. */}
      {detail?.cast.length ? (
        <section className="more-section more-rail more-cast" aria-label="Cast">
          <div className="more-section-head rail-heading">
            <h2>Cast</h2>
          </div>
          <ContentCarousel label="Cast">
            {detail.cast.map((member, index) => (
              <figure className="more-cast-card" key={`${member.name}:${index}`}>
                {member.profileUrl ? (
                  <img src={member.profileUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="more-cast-initial" aria-hidden="true">
                    {member.name.charAt(0)}
                  </span>
                )}
                <figcaption>
                  <strong>{member.name}</strong>
                  {member.character ? <span>{member.character}</span> : null}
                </figcaption>
              </figure>
            ))}
          </ContentCarousel>
        </section>
      ) : null}
      {detail?.recommendations.length ? (
        <section className="more-section more-similar" aria-label="More like this">
          <div className="more-section-head">
            <h2>More like this</h2>
          </div>
          <SimilarTitles
            items={detail.recommendations.map((pick) => ({
              key: moreKey(pick),
              title: pick.title,
              posterUrl: pick.posterUrl,
              meta: [pick.type === "MOVIE" ? "Movie" : "TV", pick.year].filter(Boolean).join(" · "),
              score: pick.score ? { label: formatScore(pick.score) ?? "", star: true } : undefined,
              onSelect: () => onOpenTitle?.(pick),
            }))}
          />
        </section>
      ) : null}
    </section>
  );
}

/** Simkl and IMDb scores (through Simkl) while Simkl is connected; nothing otherwise. */
function useSimklTitleRatings(tmdbId: number, type: MoreMediaType): SimklTitleRatings | undefined {
  const status = useSimklStatus();
  const connected = status?.auth.status === "connected";
  const [ratings, setRatings] = useState<{ key: string; value?: SimklTitleRatings }>();
  const key = `${type}:${tmdbId}`;
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    window.anistream
      .getSimklTitleRatings({ tmdbId, type })
      .then((value) => alive && setRatings({ key, value }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connected, key, tmdbId, type]);
  return connected && ratings?.key === key ? ratings.value : undefined;
}
