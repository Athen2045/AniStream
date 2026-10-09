import type {
  MoreCatalogItem,
  MoreDetail,
  MoreTitleProgress,
  MoreTitleSnapshot,
} from "../../shared/contracts";

/** Mirrors the main-process threshold: at or past this fraction a title or episode is finished. */
export const MORE_FINISHED_RATIO = 0.92;

export interface MorePlayTarget {
  season: number;
  episode: number;
}

export function moreKey(item: Pick<MoreCatalogItem, "id" | "type">): string {
  return `${item.type}:${item.id}`;
}

export function moreSnapshot(item: MoreCatalogItem): MoreTitleSnapshot {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    ...(item.backdropUrl ? { backdropUrl: item.backdropUrl } : {}),
    ...(item.year ? { year: item.year } : {}),
    ...(item.score !== undefined ? { score: item.score } : {}),
  };
}

export function isFinished(
  progress: Pick<MoreTitleProgress, "positionSeconds" | "durationSeconds">,
): boolean {
  return progress.positionSeconds >= progress.durationSeconds * MORE_FINISHED_RATIO;
}

export function progressRatio(
  progress: Pick<MoreTitleProgress, "positionSeconds" | "durationSeconds">,
): number {
  if (progress.durationSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, progress.positionSeconds / progress.durationSeconds));
}

export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(1, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatRemaining(
  progress: Pick<MoreTitleProgress, "positionSeconds" | "durationSeconds">,
): string {
  return `${formatDuration((progress.durationSeconds - progress.positionSeconds) / 60)} left`;
}

export function episodeLabel(season: number, episode: number): string {
  return `S${season}:E${episode}`;
}

export function formatScore(score: number | undefined): string | undefined {
  return score && score > 0 ? score.toFixed(1) : undefined;
}

export function formatLongDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** The episode after `target`, crossing into the next regular season when this one ends. */
export function nextEpisode(
  detail: MoreDetail,
  target: MorePlayTarget,
): MorePlayTarget | undefined {
  const seasons = detail.seasons.filter((season) => season.number > 0);
  const current = seasons.find((season) => season.number === target.season);
  if (current?.episodeCount && target.episode < current.episodeCount)
    return { season: target.season, episode: target.episode + 1 };
  const following = seasons.find((season) => season.number > target.season);
  return following ? { season: following.number, episode: 1 } : undefined;
}

/**
 * What the primary button should do for a title: resume the latest unfinished episode, move on
 * to the next one after a finished episode, or start from the first regular episode.
 */
export function resumeTarget(
  detail: MoreDetail | undefined,
  progress: MoreTitleProgress[],
): { target?: MorePlayTarget; mode: "resume" | "next" | "start" } {
  const latest = progress[0];
  if (!detail || detail.type === "MOVIE") {
    return { mode: latest && !isFinished(latest) ? "resume" : "start" };
  }
  const firstSeason = detail.seasons.find((season) => season.number > 0)?.number ?? 1;
  if (!latest?.season || !latest.episode)
    return { target: { season: firstSeason, episode: 1 }, mode: "start" };
  const latestTarget = { season: latest.season, episode: latest.episode };
  if (!isFinished(latest)) return { target: latestTarget, mode: "resume" };
  const next = nextEpisode(detail, latestTarget);
  return next ? { target: next, mode: "next" } : { target: latestTarget, mode: "resume" };
}

const UNRELEASED_STATUSES = new Set([
  "Planned",
  "In Production",
  "Post Production",
  "Rumored",
  "Pilot",
]);

export interface ReleaseState {
  unreleased: boolean;
  /** e.g. "Available Dec 18, 2026", or a note that no date is announced yet. */
  label?: string;
}

function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A title is unreleased when TMDB's release (or first-air) date is still in the future, or when it
 * has no date and TMDB marks it as not yet produced. Only `status` from a detail lookup can make an
 * undated title unreleased; catalog items without a date are treated as playable.
 */
export function releaseState(
  releaseDate: string | undefined,
  status?: string,
  now: Date = new Date(),
): ReleaseState {
  if (releaseDate) {
    return releaseDate > localIsoDate(now)
      ? { unreleased: true, label: `Available ${formatShortDate(releaseDate)}` }
      : { unreleased: false };
  }
  return status && UNRELEASED_STATUSES.has(status)
    ? { unreleased: true, label: "Release date not announced" }
    : { unreleased: false };
}

/** Whether an episode's air date is still ahead. */
export function isUpcoming(airDate: string | undefined, now: Date = new Date()): boolean {
  return Boolean(airDate && airDate > localIsoDate(now));
}
