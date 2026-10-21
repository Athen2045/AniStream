import type { AniListMediaType, BrowseAniListInput } from "../../shared/contracts";
import type { AniListSeasonFilter } from "../../shared/anilist-filters";
import { MORE_GENRES, MORE_LANGUAGES, type MoreBrowseInput } from "../../shared/more-filters";

/**
 * Starter rows (user feedback 2026-10-20: a first launch without AniList or Simkl looked plain).
 * Until For You has three titles to learn from, each section opens like a streaming home page:
 * what is airing, what is coming, all-time favourites and a few genres. They come from public
 * catalog reads only (AniList browse, TMDB discover), so nothing about the viewer leaves the device.
 * Genres and languages rotate once a day, so a returning viewer sees a different selection.
 */
export interface AniListStarterRow {
  id: string;
  title: string;
  kicker: string;
  input: Omit<BrowseAniListInput, "page">;
}

export interface MoreStarterRow {
  id: string;
  title: string;
  input: Omit<MoreBrowseInput, "page">;
}

const SEASONS: readonly AniListSeasonFilter[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
export const ANIME_GENRES = [
  "Action",
  "Romance",
  "Comedy",
  "Fantasy",
  "Sci-Fi",
  "Slice of Life",
  "Mystery",
  "Sports",
  "Drama",
  "Psychological",
  "Adventure",
  "Supernatural",
  "Horror",
  "Mecha",
];
export const MANGA_GENRES = [
  "Action",
  "Romance",
  "Comedy",
  "Fantasy",
  "Drama",
  "Slice of Life",
  "Mystery",
  "Psychological",
  "Adventure",
  "Supernatural",
  "Horror",
  "Sports",
  "Sci-Fi",
];
const PER_ROW = 20;

/** AniList's seasons: Winter is January–March, and so on. */
export function animeSeason(
  now: number,
  offset = 0,
): { season: AniListSeasonFilter; year: number } {
  const date = new Date(now);
  const index = Math.floor(date.getMonth() / 3) + offset;
  return {
    season: SEASONS[((index % 4) + 4) % 4],
    year: date.getFullYear() + Math.floor(index / 4),
  };
}

const seasonLabel = ({ season, year }: { season: AniListSeasonFilter; year: number }): string =>
  `${season[0]}${season.slice(1).toLowerCase()} ${year}`;

/** `count` different entries of `list`, the same all day and a new set the next day. */
export function dailyPick<T>(list: readonly T[], count: number, now: number, salt = 0): T[] {
  const day = Math.floor(now / 86_400_000) + salt * 7;
  // A step coprime with the list length visits every entry before repeating.
  let step = 5;
  while (gcd(step, list.length) !== 1) step += 1;
  return Array.from(
    { length: Math.min(count, list.length) },
    (_, index) => list[(day * 3 + index * step) % list.length],
  );
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** The three genres today's Anime or Manga starter rows show. */
function starterGenres(type: AniListMediaType, now: number): string[] {
  return dailyPick(type === "ANIME" ? ANIME_GENRES : MANGA_GENRES, 3, now);
}

export type GenreSection = AniListMediaType | "MORE";

/** The genres the Genre row offers in a section (no adult genres; More uses TMDB's names). */
export function genreChoices(section: GenreSection): readonly string[] {
  if (section === "ANIME") return ANIME_GENRES;
  if (section === "MANGA") return MANGA_GENRES;
  return MORE_GENRES.filter((genre) => genre.name !== "Kids" && genre.name !== "Reality").map(
    (genre) => genre.name,
  );
}

/**
 * The Genre row's genre before the viewer picks one: rotates daily and avoids the genres today's
 * starter rows already show, so the page does not open with the same genre twice.
 */
export function defaultGenre(section: GenreSection, now: number): string {
  const taken =
    section === "MORE"
      ? moreStarterRows(now).flatMap((row) => (row.input.genre ? [row.input.genre] : []))
      : starterGenres(section, now);
  const free = genreChoices(section).filter((genre) => !taken.includes(genre));
  return dailyPick(free, 1, now, 2)[0];
}

/** What the Genre row asks for: the genre's most popular titles (movies first in More). */
export function genreRowInput(
  section: AniListMediaType,
  genre: string,
): Omit<BrowseAniListInput, "page">;
export function genreRowInput(section: "MORE", genre: string): Omit<MoreBrowseInput, "page">;
export function genreRowInput(
  section: GenreSection,
  genre: string,
): Omit<BrowseAniListInput, "page"> | Omit<MoreBrowseInput, "page"> {
  if (section === "MORE") {
    const tmdb = MORE_GENRES.find((entry) => entry.name === genre);
    return { type: tmdb?.movie ? "MOVIE" : "TV", sort: "popular", genre };
  }
  return {
    type: section,
    perPage: PER_ROW,
    genre,
    sort: "POPULARITY_DESC",
    ...(section === "MANGA" ? { format: "MANGA" as const } : {}),
  };
}

export function aniListStarterRows(type: AniListMediaType, now: number): AniListStarterRow[] {
  // Manga rows keep to comics: light novels have their own format.
  const base: Pick<BrowseAniListInput, "type" | "perPage" | "format"> = {
    type,
    perPage: PER_ROW,
    format: type === "MANGA" ? "MANGA" : undefined,
  };
  const favourites: AniListStarterRow = {
    id: "favourites",
    title: "All-time favourites",
    kicker: "Highest rated on AniList",
    input: { ...base, sort: "SCORE_DESC" },
  };
  const genre = (name: string): AniListStarterRow => ({
    id: `genre:${name}`,
    title: `Top rated ${name}`,
    kicker: type === "ANIME" ? "Anime by genre" : "Manga by genre",
    input: { ...base, genre: name, sort: "SCORE_DESC" },
  });
  if (type === "ANIME") {
    const current = animeSeason(now);
    const next = animeSeason(now, 1);
    const [first, second, third] = starterGenres("ANIME", now).map(genre);
    return [
      {
        id: "season",
        title: "Airing this season",
        kicker: seasonLabel(current),
        input: { ...base, ...current, sort: "POPULARITY_DESC" },
      },
      favourites,
      first,
      {
        id: "next-season",
        title: "Coming next season",
        kicker: seasonLabel(next),
        input: { ...base, ...next, status: "NOT_YET_RELEASED", sort: "POPULARITY_DESC" },
      },
      second,
      {
        id: "films",
        title: "Anime films",
        kicker: "Most popular on AniList",
        input: { ...base, format: "MOVIE", sort: "POPULARITY_DESC" },
      },
      third,
    ];
  }
  const [first, second, third] = starterGenres("MANGA", now).map(genre);
  return [
    {
      id: "publishing",
      title: "Publishing now",
      kicker: "Ongoing series",
      input: { ...base, status: "RELEASING", sort: "POPULARITY_DESC" },
    },
    favourites,
    first,
    {
      id: "manhwa",
      title: "Popular manhwa",
      kicker: "From Korea",
      input: { ...base, country: "KR", sort: "POPULARITY_DESC" },
    },
    second,
    {
      id: "one-shots",
      title: "One-shots",
      kicker: "Read in one sitting",
      input: { ...base, format: "ONE_SHOT", sort: "POPULARITY_DESC" },
    },
    third,
  ];
}

export function moreStarterRows(now: number): MoreStarterRow[] {
  const movieGenres = MORE_GENRES.filter((genre) => genre.movie && genre.name !== "Documentary");
  const showGenres = MORE_GENRES.filter(
    (genre) => genre.tv && !["Kids", "Reality", "Documentary"].includes(genre.name),
  );
  const [movieGenre] = dailyPick(movieGenres, 1, now);
  // A different genre for shows than for movies the same day.
  const [showGenre] = dailyPick(
    showGenres.filter((genre) => genre.name !== movieGenre.name),
    1,
    now,
    1,
  );
  const [language] = dailyPick(
    MORE_LANGUAGES.filter((entry) => entry.code !== "en"),
    1,
    now,
  );
  return [
    { id: "rated-movies", title: "Top rated movies", input: { type: "MOVIE", sort: "rated" } },
    {
      id: `genre-movies:${movieGenre.name}`,
      title: `Popular ${movieGenre.name.toLowerCase()} movies`,
      input: { type: "MOVIE", sort: "popular", genre: movieGenre.name },
    },
    { id: "rated-shows", title: "Top rated shows", input: { type: "TV", sort: "rated" } },
    {
      id: `language:${language.code}`,
      title: `Popular in ${language.label}`,
      input: { type: "MOVIE", sort: "popular", language: language.code },
    },
    {
      id: `genre-shows:${showGenre.name}`,
      title: `Popular ${showGenre.name.toLowerCase()} shows`,
      input: { type: "TV", sort: "popular", genre: showGenre.name },
    },
  ];
}
