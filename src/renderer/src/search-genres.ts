import type { AniListCatalogMedia, MoreCatalogItem } from "../../shared/contracts";
import type { SearchResults, SearchScope } from "./search-queries";

/** Genre tiles before typing: the AniList / TMDB genre each one filters. */
export const GENRE_TILES: Record<SearchScope, ReadonlyArray<{ genre: string }>> = {
  ANIME: [
    { genre: "Action" },
    { genre: "Romance" },
    { genre: "Fantasy" },
    { genre: "Comedy" },
    { genre: "Sci-Fi" },
    { genre: "Slice of Life" },
    { genre: "Horror" },
    { genre: "Sports" },
  ],
  MANGA: [
    { genre: "Action" },
    { genre: "Romance" },
    { genre: "Fantasy" },
    { genre: "Comedy" },
    { genre: "Drama" },
    { genre: "Slice of Life" },
    { genre: "Mystery" },
    { genre: "Horror" },
  ],
  MORE: [
    { genre: "Action" },
    { genre: "Comedy" },
    { genre: "Drama" },
    { genre: "Sci-Fi" },
    { genre: "Crime" },
    { genre: "Romance" },
    { genre: "Documentary" },
    { genre: "Family" },
  ],
};

/** Posters fanned on each genre tile. */
export const GENRE_POSTERS = 3;

/**
 * Posters for each genre tile: up to three trending titles of that genre, never one already shown
 * on an earlier tile (fewer rather than a repeat).
 */
export function genreArtwork(
  scope: SearchScope,
  trending: SearchResults | undefined,
): Map<string, string[]> {
  const art = new Map<string, string[]>();
  const used = new Set<string>();
  const items: Array<{ genres: readonly string[]; poster?: string }> =
    trending?.kind === "anilist"
      ? trending.items.map((item: AniListCatalogMedia) => ({
          genres: item.genres,
          poster: item.coverUrl,
        }))
      : trending?.kind === "more"
        ? trending.items.map((item: MoreCatalogItem) => ({
            // TMDB names the genre "Science Fiction"; the filter calls it "Sci-Fi".
            genres: item.genres.map((genre) => (genre === "Science Fiction" ? "Sci-Fi" : genre)),
            poster: item.posterUrl,
          }))
        : [];
  for (const tile of GENRE_TILES[scope]) {
    const posters: string[] = [];
    for (const item of items) {
      if (posters.length === GENRE_POSTERS) break;
      if (!item.poster || used.has(item.poster) || !item.genres.includes(tile.genre)) continue;
      used.add(item.poster);
      posters.push(item.poster);
    }
    if (posters.length) art.set(tile.genre, posters);
  }
  return art;
}
