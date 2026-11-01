import type { MoreMediaType } from "../shared/contracts";

export interface AnimeHeroBackdropDeps {
  /** Exact AniList ↔ TMDB links (Wikidata IDs), as `MOVIE:id` / `TV:id` keys. */
  tmdbKeysFor: (aniListId: number) => string[];
  /** TMDB's full-size backdrop for a show or film, if it has one. */
  backdrop: (tmdbId: number, type: MoreMediaType) => Promise<string | undefined>;
}

/**
 * A 16:9 backdrop for an anime title page, from the TMDB title it is exactly linked to: a film for
 * an anime movie, a show for everything else (season entries share their show's backdrop). AniList
 * only has 1900×400 banners, which blur when stretched over a tall header. Never matched by title.
 */
export async function animeHeroBackdrop(
  deps: AnimeHeroBackdropDeps,
  input: { aniListId: number; movie: boolean },
): Promise<string | undefined> {
  const prefix = input.movie ? "MOVIE:" : "TV:";
  const key = deps.tmdbKeysFor(input.aniListId).find((link) => link.startsWith(prefix));
  if (!key) return undefined;
  return deps.backdrop(Number(key.slice(prefix.length)), input.movie ? "MOVIE" : "TV");
}
