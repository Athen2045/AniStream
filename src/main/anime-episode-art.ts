import type { AnimeTmdbLinkIndex } from "./anime-tmdb-links";
import type { AnimeEpisodeArt, MoreDetail, MoreSeasonDetail } from "../shared/contracts";

/**
 * TMDB episode stills for an AniList anime (user request 2026-10-08).
 *
 * Identity is the exact Wikidata AniList → TMDB TV link; never title text. AniList splits a show
 * into one entry per season or cour while TMDB groups episodes its own way, so the entry is
 * anchored by date: the TMDB episode that aired on the AniList start date (± two days for time
 * zones) is episode 1, and later episodes follow in TMDB order across season boundaries. A new
 * season without its own Wikidata link borrows its AniList prequel's series (up to three hops);
 * the date anchor still has to match. Without an exact start date or an anchor the anime keeps its
 * current artwork.
 */
export interface EpisodeArtDeps {
  links: () => AnimeTmdbLinkIndex;
  /** AniList start date (`YYYY-MM-DD`; partial dates are rejected) and anime prequel IDs. */
  media: (aniListId: number) => Promise<{ startDate?: string; prequels: number[] }>;
  detail: (tmdbId: number) => Promise<MoreDetail>;
  season: (tmdbId: number, seasonNumber: number) => Promise<MoreSeasonDetail>;
}

export interface EpisodeArtInput {
  aniListId: number;
  /** Episodes in the AniList entry (or aired so far). */
  episodes: number;
  /** The episode the viewer is on; for long series the seasons around it are fetched first. */
  focus: number;
}

const DAY_MS = 86_400_000;
const ANCHOR_TOLERANCE_MS = 2 * DAY_MS;
/** TMDB season requests per title, anchor search included (long runners get the focus area). */
const MAX_SEASON_REQUESTS = 6;
const MAX_EPISODES = 2_000;
const MAX_PREQUEL_HOPS = 3;

export interface EpisodeArtResult {
  art: AnimeEpisodeArt[];
  /** False when a TMDB season request failed; the caller should not cache a partial result. */
  complete: boolean;
}

export async function animeEpisodeArt(
  deps: EpisodeArtDeps,
  input: EpisodeArtInput,
): Promise<EpisodeArtResult> {
  const result: EpisodeArtResult = { art: [], complete: true };
  const media = await deps.media(input.aniListId);
  const start = media.startDate;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return result;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const total = Math.min(Math.max(0, Math.floor(input.episodes)), MAX_EPISODES);
  if (!total || !Number.isFinite(startMs)) return result;
  const tvFor = (id: number): number[] =>
    deps
      .links()
      .tmdbKeysFor(id)
      .filter((key) => key.startsWith("TV:"))
      .map((key) => Number(key.slice(3)))
      .slice(0, 2);
  let tvIds = tvFor(input.aniListId);
  let prequel = media.prequels[0];
  for (let hop = 0; !tvIds.length && prequel !== undefined && hop < MAX_PREQUEL_HOPS; hop += 1) {
    tvIds = tvFor(prequel);
    if (!tvIds.length) prequel = (await deps.media(prequel)).prequels[0];
  }

  for (const tmdbId of tvIds) {
    result.art = await fromSeries(deps, tmdbId, startMs, total, input.focus, () => {
      result.complete = false;
    });
    if (result.art.length) break;
  }
  return result;
}

async function fromSeries(
  deps: EpisodeArtDeps,
  tmdbId: number,
  startMs: number,
  total: number,
  focus: number,
  onFailure: () => void,
): Promise<AnimeEpisodeArt[]> {
  const seasons = (await deps.detail(tmdbId)).seasons
    .filter((season) => season.number > 0 && (season.episodeCount ?? 0) > 0)
    .sort((a, b) => a.number - b.number);
  const fetched = new Map<number, MoreSeasonDetail>();
  let budget = MAX_SEASON_REQUESTS;
  const load = async (index: number): Promise<MoreSeasonDetail | undefined> => {
    const number = seasons[index].number;
    if (fetched.has(number)) return fetched.get(number);
    if (budget <= 0) return undefined;
    budget -= 1;
    try {
      const season = await deps.season(tmdbId, number);
      fetched.set(number, season);
      return season;
    } catch {
      // One failed season costs only its own stills; the rest still show.
      onFailure();
      return undefined;
    }
  };
  const count = (index: number): number =>
    fetched.get(seasons[index].number)?.episodes.length ?? seasons[index].episodeCount ?? 0;

  // The season that started last on or before the AniList start, then the one before it (a split
  // cour can begin partway through an earlier TMDB season).
  let latest = -1;
  seasons.forEach((season, index) => {
    if (season.airDate && Date.parse(season.airDate) <= startMs + ANCHOR_TOLERANCE_MS)
      latest = index;
  });
  let anchor: { season: number; episode: number } | undefined;
  for (const index of [latest, latest - 1]) {
    if (index < 0 || anchor) continue;
    const season = await load(index);
    const episode =
      season?.episodes.findIndex(
        (row) =>
          row.airDate !== undefined &&
          Math.abs(Date.parse(row.airDate) - startMs) <= ANCHOR_TOLERANCE_MS,
      ) ?? -1;
    if (episode >= 0) anchor = { season: index, episode };
  }
  if (!anchor) return [];

  // Where each AniList episode sits in TMDB's seasons.
  const placed: { number: number; season: number; episode: number }[] = [];
  let season = anchor.season;
  let episode = anchor.episode;
  for (let number = 1; number <= total && season < seasons.length; number += 1) {
    placed.push({ number, season, episode });
    episode += 1;
    while (season < seasons.length && episode >= count(season)) {
      episode -= count(season);
      season += 1;
    }
  }

  // Fetch the seasons nearest the viewer's episode first while the request budget lasts.
  const focusSeason =
    placed.find((row) => row.number === Math.max(1, Math.min(focus, total)))?.season ??
    anchor.season;
  const wanted = [...new Set(placed.map((row) => row.season))].sort(
    (a, b) => Math.abs(a - focusSeason) - Math.abs(b - focusSeason) || a - b,
  );
  for (const index of wanted) {
    if (budget <= 0) break;
    await load(index);
  }

  return placed.flatMap(({ number, season: index, episode: at }) => {
    const stillUrl = fetched.get(seasons[index].number)?.episodes[at]?.stillUrl;
    return stillUrl ? [{ number, stillUrl }] : [];
  });
}
