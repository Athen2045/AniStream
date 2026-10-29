import type { AniListCatalogMedia, MoreCatalogItem } from "../../shared/contracts";
import type { SearchResults, SearchScope } from "./search-queries";

/** Genre tiles before typing: the tint behind each, and the AniList / TMDB genre it filters. */
export const GENRE_TILES: Record<SearchScope, ReadonlyArray<{ genre: string; color: string }>> = {
  ANIME: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Fantasy", color: "#6d28d9" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Sci-Fi", color: "#0369a1" },
    { genre: "Slice of Life", color: "#15803d" },
    { genre: "Horror", color: "#7f1d1d" },
    { genre: "Sports", color: "#0f766e" },
  ],
  MANGA: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Fantasy", color: "#6d28d9" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Drama", color: "#0369a1" },
    { genre: "Slice of Life", color: "#15803d" },
    { genre: "Mystery", color: "#4c1d95" },
    { genre: "Horror", color: "#7f1d1d" },
  ],
  MORE: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Drama", color: "#0369a1" },
    { genre: "Sci-Fi", color: "#6d28d9" },
    { genre: "Crime", color: "#7f1d1d" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Documentary", color: "#15803d" },
    { genre: "Family", color: "#0f766e" },
  ],
};

/**
 * Artwork for each genre tile: a different trending title's banner or backdrop per tile (none
 * rather than a repeat).
 */
export function genreArtwork(
  scope: SearchScope,
  trending: SearchResults | undefined,
): Map<string, string> {
  const art = new Map<string, string>();
  const used = new Set<string>();
  for (const tile of GENRE_TILES[scope]) {
    const found =
      trending?.kind === "anilist"
        ? trending.items.find(
            (item: AniListCatalogMedia) =>
              item.genres.includes(tile.genre) && item.bannerUrl && !used.has(item.bannerUrl),
          )?.bannerUrl
        : trending?.kind === "more"
          ? trending.items.find(
              (item: MoreCatalogItem) =>
                // TMDB names the genre "Science Fiction"; the filter calls it "Sci-Fi".
                (item.genres.includes(tile.genre) ||
                  (tile.genre === "Sci-Fi" && item.genres.includes("Science Fiction"))) &&
                item.backdropUrl &&
                !used.has(item.backdropUrl),
            )?.backdropUrl
          : undefined;
    if (found) {
      used.add(found);
      art.set(tile.genre, found);
    }
  }
  return art;
}
