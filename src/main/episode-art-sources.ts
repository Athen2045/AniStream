import type { AnimeEpisodeArt, AnimeEpisodeArtInput } from "../shared/contracts";
import { KITSU_EPISODE_PAGE_SIZE, planKitsuEpisodePages } from "./kitsu-episode-art";

/** One provider of anime episode thumbnails, keyed by AniList episode number. */
export interface EpisodeArtSource {
  load(input: AnimeEpisodeArtInput): Promise<{ art: AnimeEpisodeArt[]; complete: boolean }>;
}

export interface EpisodeArtChainResult {
  art: AnimeEpisodeArt[];
  /** False when a source failed or returned a partial result; the caller should not cache it. */
  complete: boolean;
}

/**
 * Episode thumbnails from several sources in priority order (user decision 2026-10-13: ani.zip,
 * then Kitsu, then TMDB). An earlier source wins for an episode; a later source is asked only
 * while episodes near the viewer's focus still have no thumbnail. A failing source costs only its
 * own thumbnails.
 */
export async function chainEpisodeArt(
  sources: readonly EpisodeArtSource[],
  input: AnimeEpisodeArtInput,
): Promise<EpisodeArtChainResult> {
  const byNumber = new Map<number, AnimeEpisodeArt>();
  let complete = true;
  const wanted = focusWindow(input);
  for (const source of sources) {
    // Later sources fill thumbnails only; titles and synopses never trigger another request.
    if (wanted.every((number) => byNumber.get(number)?.stillUrl)) break;
    try {
      const result = await source.load(input);
      if (!result.complete) complete = false;
      for (const row of result.art) {
        const known = byNumber.get(row.number);
        // Field by field, the earlier source wins.
        byNumber.set(
          row.number,
          known ? { ...withoutUndefined(row), ...withoutUndefined(known) } : row,
        );
      }
    } catch {
      complete = false;
    }
  }
  return { art: [...byNumber.values()].sort((a, b) => a.number - b.number), complete };
}

/** The episode numbers around the focus that a lookup tries to fill (at most 120). */
function focusWindow(input: AnimeEpisodeArtInput): number[] {
  const total = Math.floor(input.episodes);
  return planKitsuEpisodePages(input.episodes, input.focus).flatMap((offset) =>
    Array.from({ length: KITSU_EPISODE_PAGE_SIZE }, (_, index) => offset + index + 1).filter(
      (number) => number <= total,
    ),
  );
}

function withoutUndefined(row: AnimeEpisodeArt): AnimeEpisodeArt {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as unknown as AnimeEpisodeArt;
}
