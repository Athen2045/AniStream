import type { AniListMediaType } from "./contracts";

/**
 * Catalog filters AniList's `Page.media` accepts (verified by live schema introspection
 * 2026-10-06). Values are AniList enum spellings so the main process can pass them through.
 */
export const ANIME_FORMATS = ["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"] as const;
export const MANGA_FORMATS = ["MANGA", "NOVEL", "ONE_SHOT"] as const;
export const MEDIA_STATUSES = [
  "RELEASING",
  "FINISHED",
  "NOT_YET_RELEASED",
  "HIATUS",
  "CANCELLED",
] as const;
export const MEDIA_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export const ORIGIN_COUNTRIES = ["JP", "KR", "CN", "TW"] as const;

export type AniListFormatFilter = (typeof ANIME_FORMATS)[number] | (typeof MANGA_FORMATS)[number];
export type AniListStatusFilter = (typeof MEDIA_STATUSES)[number];
export type AniListSeasonFilter = (typeof MEDIA_SEASONS)[number];
export type AniListCountryFilter = (typeof ORIGIN_COUNTRIES)[number];

export const FILTER_YEAR_MIN = 1940;
/** Announced titles reach a couple of years ahead. */
export function filterYearMax(now = new Date()): number {
  return now.getFullYear() + 2;
}

export interface AniListBrowseFilters {
  format?: AniListFormatFilter;
  status?: AniListStatusFilter;
  /** Anime only. */
  season?: AniListSeasonFilter;
  /** Anime: season year. Manga: start-date year. */
  year?: number;
  country?: AniListCountryFilter;
  /** Exact AniList tag name. */
  tag?: string;
  /** AniList average score (0–100) the title must exceed. */
  minScore?: number;
}

export const FILTER_KEYS = [
  "format",
  "status",
  "season",
  "year",
  "country",
  "tag",
  "minScore",
] as const satisfies readonly (keyof AniListBrowseFilters)[];

export function formatsFor(type: AniListMediaType): readonly AniListFormatFilter[] {
  return type === "ANIME" ? ANIME_FORMATS : MANGA_FORMATS;
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Validates untrusted filter fields for one media type. Throws on any value AniList would not
 * accept for that type (a season on manga, a manga format on anime, an out-of-range year).
 */
export function parseBrowseFilters(
  type: AniListMediaType,
  value: Record<string, unknown>,
  now = new Date(),
): AniListBrowseFilters {
  const filters: AniListBrowseFilters = {};
  const { format, status, season, year, country, tag, minScore } = value;
  if (format !== undefined) {
    if (!includes(formatsFor(type), format)) throw new Error("Invalid AniList format filter.");
    filters.format = format;
  }
  if (status !== undefined) {
    if (!includes(MEDIA_STATUSES, status)) throw new Error("Invalid AniList status filter.");
    filters.status = status;
  }
  if (season !== undefined) {
    if (type !== "ANIME" || !includes(MEDIA_SEASONS, season))
      throw new Error("Invalid AniList season filter.");
    filters.season = season;
  }
  if (year !== undefined) {
    if (
      typeof year !== "number" ||
      !Number.isInteger(year) ||
      year < FILTER_YEAR_MIN ||
      year > filterYearMax(now)
    )
      throw new Error("Invalid AniList year filter.");
    filters.year = year;
  }
  if (country !== undefined) {
    if (!includes(ORIGIN_COUNTRIES, country)) throw new Error("Invalid AniList country filter.");
    filters.country = country;
  }
  if (tag !== undefined) {
    if (typeof tag !== "string") throw new Error("Invalid AniList tag filter.");
    const trimmed = tag.trim();
    if (trimmed.length < 1 || trimmed.length > 80 || /[\p{Cc}]/u.test(trimmed))
      throw new Error("Invalid AniList tag filter.");
    filters.tag = trimmed;
  }
  if (minScore !== undefined) {
    if (
      typeof minScore !== "number" ||
      !Number.isInteger(minScore) ||
      minScore < 0 ||
      minScore > 99
    )
      throw new Error("Invalid AniList score filter.");
    filters.minScore = minScore;
  }
  return filters;
}

/** Genres and non-adult tags offered by the filter drawer. */
export interface AniListFilterOptions {
  genres: string[];
  tags: { name: string; category?: string }[];
}

export const FORMAT_LABELS: Record<AniListFormatFilter, string> = {
  TV: "TV",
  TV_SHORT: "TV short",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
  MANGA: "Manga",
  NOVEL: "Light novel",
  ONE_SHOT: "One shot",
};

export const STATUS_LABELS: Record<AniListStatusFilter, string> = {
  RELEASING: "Releasing",
  FINISHED: "Finished",
  NOT_YET_RELEASED: "Not yet released",
  HIATUS: "On hiatus",
  CANCELLED: "Cancelled",
};

export const SEASON_LABELS: Record<AniListSeasonFilter, string> = {
  WINTER: "Winter",
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
};

export const COUNTRY_LABELS: Record<AniListCountryFilter, string> = {
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  TW: "Taiwan",
};
