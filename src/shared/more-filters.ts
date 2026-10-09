import type { MoreMediaType } from "./contracts";

/**
 * More (TMDB) search filters (user request 2026-10-09), kept as small as the Anime/Manga bar:
 * type, genre, language, year, score and sort.
 *
 * TMDB's discover endpoint filters but takes no title, and its search takes a title but no
 * filters, so filters alone browse `/discover`, and a title with filters narrows `/search`
 * results by the same fields.
 */
export type MoreSort = "popular" | "rated" | "newest";

export interface MoreBrowseFilters {
  /** Movies, shows, or both when unset. */
  type?: MoreMediaType;
  genre?: string;
  /** ISO 639-1 original language, e.g. "ml". */
  language?: string;
  year?: number;
  /** Minimum TMDB rating on its 0-10 scale. */
  minScore?: number;
  sort: MoreSort;
}

export interface MoreBrowseInput extends Omit<MoreBrowseFilters, "type"> {
  type: MoreMediaType;
  page: number;
  query?: string;
}

/**
 * Genre names shown in the bar with their TMDB IDs per type (verified against `/genre/movie/list`
 * and `/genre/tv/list` 2026-10-09). TV merges some genres ("Action & Adventure", "Sci-Fi &
 * Fantasy", "War & Politics"); genres a type lacks search only the other type.
 */
export const MORE_GENRES: ReadonlyArray<{ name: string; movie?: number; tv?: number }> = [
  { name: "Action", movie: 28, tv: 10759 },
  { name: "Adventure", movie: 12, tv: 10759 },
  { name: "Animation", movie: 16, tv: 16 },
  { name: "Comedy", movie: 35, tv: 35 },
  { name: "Crime", movie: 80, tv: 80 },
  { name: "Documentary", movie: 99, tv: 99 },
  { name: "Drama", movie: 18, tv: 18 },
  { name: "Family", movie: 10751, tv: 10751 },
  { name: "Fantasy", movie: 14, tv: 10765 },
  { name: "Horror", movie: 27 },
  { name: "Kids", tv: 10762 },
  { name: "Mystery", movie: 9648, tv: 9648 },
  { name: "Reality", tv: 10764 },
  { name: "Romance", movie: 10749 },
  { name: "Sci-Fi", movie: 878, tv: 10765 },
  { name: "Thriller", movie: 53 },
  { name: "War", movie: 10752, tv: 10768 },
  { name: "Western", movie: 37, tv: 37 },
];

export const MORE_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ml", label: "Malayalam" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "tr", label: "Turkish" },
  { code: "th", label: "Thai" },
  { code: "pt", label: "Portuguese" },
];

export const MORE_SORT_LABELS: Record<MoreSort, string> = {
  popular: "Most popular",
  rated: "Highest rated",
  newest: "Newest",
};

export const MORE_SCORE_STEPS = [5, 6, 7, 8] as const;
export const MORE_YEAR_MIN = 1950;

/** The TMDB genre ID for a type, or undefined when that type has no such genre. */
export function moreGenreId(name: string, type: MoreMediaType): number | undefined {
  const genre = MORE_GENRES.find((row) => row.name === name);
  return type === "MOVIE" ? genre?.movie : genre?.tv;
}

/** Types worth querying for these filters (a movie-only genre skips shows, and so on). */
export function moreTypesFor(filters: MoreBrowseFilters): MoreMediaType[] {
  const types: MoreMediaType[] = filters.type ? [filters.type] : ["MOVIE", "TV"];
  return filters.genre
    ? types.filter((type) => moreGenreId(filters.genre!, type) !== undefined)
    : types;
}

/** Filters that narrow results; sort alone only reorders them. */
export function moreFilterCount(filters: MoreBrowseFilters): number {
  return [filters.type, filters.genre, filters.language, filters.year, filters.minScore].filter(
    (value) => value !== undefined,
  ).length;
}
