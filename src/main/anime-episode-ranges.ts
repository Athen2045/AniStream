import type { AnimeEpisodeRange, AnimeEpisodeRanges, MoreSeason } from "../shared/contracts";
import type { AniZipEpisodeIndexRow } from "./anizip";
import type { TmdbStoryArc } from "./tmdb";

/**
 * Episode ranges for long runners (user request 2026-10-13): One Piece and similar single AniList
 * entries with hundreds of episodes are browsed by story arc, or by TheTVDB season when no arc
 * list exists.
 *
 * TMDB's own seasons come first when TMDB names them after the story (One Piece: "East Blue",
 * "Whiskey Peak & Little Garden", …, as in More), then TMDB's community "Story Arc" episode group. TMDB numbers episodes its own way and
 * mixes specials into arcs, so arcs are placed on AniList episode numbers by air date, using
 * ani.zip's per-episode air dates for the same AniList entry: an arc starts at the earliest AniList
 * episode that aired on one of its non-special episodes' dates and runs until the next arc starts.
 */

/** Below this many episodes an entry is browsed as one list. */
export const MIN_RANGE_EPISODES = 50;
const MAX_EPISODES = 2_000;

export interface EpisodeRangeDeps {
  /** ani.zip's index for the entry: per-episode air dates and TheTVDB seasons, plus its TMDB ID. */
  index: (aniListId: number) => Promise<{ index: AniZipEpisodeIndexRow[]; tmdbId?: number }>;
  /** The exact Wikidata AniList → TMDB TV link, preferred over ani.zip's own mapping. */
  tmdbTvId?: (aniListId: number) => number | undefined;
  storyArcs?: (tmdbId: number) => Promise<TmdbStoryArc[]>;
  /** TMDB's TV seasons (names and first air dates), from the cached show detail. */
  tvSeasons?: (tmdbId: number) => Promise<MoreSeason[]>;
}

export async function animeEpisodeRanges(
  deps: EpisodeRangeDeps,
  input: { aniListId: number; episodes: number },
): Promise<AnimeEpisodeRanges | undefined> {
  const total = Math.min(Math.floor(input.episodes), MAX_EPISODES);
  if (!(total >= MIN_RANGE_EPISODES)) return undefined;
  const { index, tmdbId: aniZipTmdbId } = await deps.index(input.aniListId);
  if (!index.length) return undefined;

  const tmdbId = deps.tmdbTvId?.(input.aniListId) ?? aniZipTmdbId;
  if (tmdbId && deps.tvSeasons) {
    try {
      const ranges = namedSeasonRanges(await deps.tvSeasons(tmdbId), index, total);
      if (ranges) return { kind: "arc", ranges };
    } catch {
      // The story-arc list below may still apply.
    }
  }
  if (tmdbId && deps.storyArcs) {
    try {
      const ranges = arcRanges(await deps.storyArcs(tmdbId), index, total);
      if (ranges) return { kind: "arc", ranges };
    } catch {
      // No arc list: TheTVDB seasons below still split the episodes.
    }
  }
  const ranges = seasonRanges(index, total);
  return ranges ? { kind: "season", ranges } : undefined;
}

export function arcRanges(
  arcs: readonly TmdbStoryArc[],
  index: readonly AniZipEpisodeIndexRow[],
  total: number,
): AnimeEpisodeRange[] | undefined {
  // Earliest AniList episode per air date (double episodes share a date).
  const byDate = new Map<string, number>();
  for (const row of index) {
    if (row.airDate && row.number <= total && !byDate.has(row.airDate))
      byDate.set(row.airDate, row.number);
  }
  const starts: { title: string; start: number; filler: boolean }[] = [];
  for (const arc of arcs) {
    const numbers = arc.episodes.flatMap((episode) => {
      const number = episode.seasonNumber > 0 && episode.airDate && byDate.get(episode.airDate);
      return number ? [number] : [];
    });
    if (!numbers.length) continue;
    const filler = /\bfiller\b/i.test(arc.name);
    // "~ Key of the Starry Sky arc ~" → "Key of the Starry Sky"; the strip is already labelled arcs.
    const title =
      arc.name
        .replace(/\s*\((filler|cover story)\)\s*$/i, "")
        .replace(/^[\s~\-–—]+|[\s~\-–—]+$/g, "")
        .replace(/\s+arc$/i, "")
        .trim() || arc.name;
    starts.push({ title, start: Math.min(...numbers), filler });
  }
  return toRanges(starts, total);
}

/**
 * TMDB seasons, when most carry a story name rather than "Season N" (as More shows them).
 *
 * TMDB often leaves a season's air date empty (One Piece: only 5 of 23 have one), so when the
 * seasons' episode counts add up to the AniList entry (TMDB may run a few episodes ahead or behind),
 * seasons are laid end to end by count. Otherwise each starts at the AniList episode that aired on
 * its first air date (within two days, for time zones).
 */
export function namedSeasonRanges(
  seasons: readonly MoreSeason[],
  index: readonly AniZipEpisodeIndexRow[],
  total: number,
): AnimeEpisodeRange[] | undefined {
  const regular = [...seasons]
    .filter((season) => season.number > 0)
    .sort((a, b) => a.number - b.number);
  const title = (season: MoreSeason): string =>
    // "S1 • Kazekage Rescue" → "Kazekage Rescue"
    season.name.replace(/^s\d+\s*[•·:\-–—]\s*/i, "").trim() || season.name.trim();
  const named = regular.filter((season) => !/^(season|series|part)\s*\d+$/i.test(title(season)));
  if (named.length < 2 || named.length < regular.length / 2) return undefined;

  const counted = regular.every((season) => (season.episodeCount ?? 0) > 0);
  const sum = regular.reduce((total, season) => total + (season.episodeCount ?? 0), 0);
  if (counted && sum >= total - 3 && sum <= total + 30) {
    let next = 1;
    const starts = regular.map((season) => {
      const start = next;
      next += season.episodeCount ?? 0;
      return { title: title(season), start, filler: false };
    });
    return toRanges(starts, total);
  }

  const dated = index.filter((row) => row.airDate && row.number <= total);
  const starts = regular.flatMap((season) => {
    if (!season.airDate) return [];
    const target = Date.parse(`${season.airDate}T00:00:00Z`);
    // The closest air date within two days (an exact match beats a neighbouring episode).
    let first: AniZipEpisodeIndexRow | undefined;
    let bestGap = 2 * 86_400_000;
    for (const row of dated) {
      const gap = Math.abs(Date.parse(`${row.airDate}T00:00:00Z`) - target);
      if (gap <= bestGap && (!first || gap < bestGap)) {
        first = row;
        bestGap = gap;
      }
    }
    return first ? [{ title: title(season), start: first.number, filler: false }] : [];
  });
  // A handful of dated seasons would hide the rest inside one huge range: use arcs instead.
  return starts.length >= named.length / 2 ? toRanges(starts, total) : undefined;
}

/** TheTVDB seasons; specials and unplaced episodes join the season around them. */
export function seasonRanges(
  index: readonly AniZipEpisodeIndexRow[],
  total: number,
): AnimeEpisodeRange[] | undefined {
  const starts: { title: string; start: number; filler: boolean }[] = [];
  let current: number | undefined;
  for (const row of index) {
    if (row.number > total || row.tvdbSeason === undefined || row.tvdbSeason === current) continue;
    // A season that resumes after another (rare) is a new run, labelled the same.
    current = row.tvdbSeason;
    starts.push({ title: `Season ${current}`, start: row.number, filler: false });
  }
  return toRanges(starts, total);
}

function toRanges(
  starts: { title: string; start: number; filler: boolean }[],
  total: number,
): AnimeEpisodeRange[] | undefined {
  const ordered = starts
    .filter((row) => row.start >= 1 && row.start <= total)
    .sort((a, b) => a.start - b.start)
    // Two arcs placed on the same first episode: keep the earlier one in TMDB order.
    .filter((row, position, rows) => position === 0 || rows[position - 1].start !== row.start);
  if (ordered.length < 2) return undefined;
  return ordered.map((row, position) => ({
    title: row.title,
    // Episodes before the first placed arc belong to it.
    start: position === 0 ? 1 : row.start,
    end: position + 1 < ordered.length ? ordered[position + 1].start - 1 : total,
    ...(row.filler ? { filler: true } : {}),
  }));
}
