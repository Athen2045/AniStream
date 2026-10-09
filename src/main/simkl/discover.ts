import type { MoreCatalogItem, MoreMediaType, SimklRow } from "../../shared/contracts";

const ROW_ITEMS = 20;
/** Simkl's CDN poster path, e.g. `20/2036989114a175eae4`. */
const POSTER_PATH = /^\d{1,4}\/[0-9a-f]{6,40}$/;

/** Trending files AniStream shows; titles name Simkl as its attribution rule requires. */
export const SIMKL_TRENDING = [
  {
    id: "trending-movies-week",
    type: "MOVIE",
    title: "Trending Movies on Simkl This Week",
    url: "https://data.simkl.in/discover/trending/movies/week_100.json",
    link: "https://simkl.com/movies/best-movies/most-watched/",
  },
  {
    id: "trending-tv-week",
    type: "TV",
    title: "Trending TV Shows on Simkl This Week",
    url: "https://data.simkl.in/discover/trending/tv/week_100.json",
    link: "https://simkl.com/tv/best-shows/most-watched/",
  },
] as const;

/**
 * Normalizes Simkl catalog entries (Trending files and Custom List items) to More cards. Only
 * entries carrying an exact TMDB ID survive, since More pages and playback are TMDB-keyed.
 */
export function simklCatalogItems(values: unknown, type: MoreMediaType): MoreCatalogItem[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<number>();
  return values.flatMap((value): MoreCatalogItem[] => {
    if (!isRecord(value) || !isRecord(value.ids)) return [];
    const tmdb = String(value.ids.tmdb ?? "");
    const id = /^\d{1,9}$/.test(tmdb) ? Number(tmdb) : 0;
    const title = typeof value.title === "string" ? value.title.trim().slice(0, 300) : "";
    if (!id || !title || seen.has(id)) return [];
    seen.add(id);
    const poster =
      typeof value.poster === "string" && POSTER_PATH.test(value.poster)
        ? `https://simkl.in/posters/${value.poster}_m.webp`
        : undefined;
    const ratings =
      isRecord(value.ratings) && isRecord(value.ratings.simkl) ? value.ratings.simkl : {};
    const score =
      typeof ratings.rating === "number" && ratings.rating >= 0 && ratings.rating <= 10
        ? Math.round(ratings.rating * 10) / 10
        : undefined;
    return [
      {
        id,
        type,
        title,
        posterUrl: poster,
        year: itemYear(value),
        score,
        genres: Array.isArray(value.genres)
          ? [
              ...new Set(
                value.genres.filter((genre): genre is string => typeof genre === "string"),
              ),
            ].slice(0, 4)
          : [],
        overview:
          typeof value.overview === "string" ? value.overview.trim().slice(0, 1_000) : undefined,
        siteUrl: `https://www.themoviedb.org/${type === "MOVIE" ? "movie" : "tv"}/${id}`,
      },
    ];
  });
}

/** One Custom List from `GET /lists/user/{id}`; only movie and TV lists can become More rows. */
export interface SimklListSummary {
  id: number;
  name: string;
  type: MoreMediaType;
  likes: number;
}

export function parseSimklLists(payload: unknown): SimklListSummary[] {
  const lists = isRecord(payload) && Array.isArray(payload.lists) ? payload.lists : [];
  return lists.flatMap((value): SimklListSummary[] => {
    if (!isRecord(value) || typeof value.id !== "number" || typeof value.name !== "string")
      return [];
    const type =
      value.media_type === "movies" ? "MOVIE" : value.media_type === "tv" ? "TV" : undefined;
    const counts = isRecord(value.counts) ? value.counts : {};
    if (!type || (typeof counts.items === "number" && counts.items < 1)) return [];
    return [
      {
        id: value.id,
        name: value.name.trim().slice(0, 120),
        type,
        likes: typeof counts.likes === "number" ? counts.likes : 0,
      },
    ];
  });
}

/** A `GET /lists/{id}` body; free accounts get HTTP 200 with `error: "premium_only"`. */
export function parseSimklList(payload: unknown, list: SimklListSummary): SimklRow | undefined {
  if (!isRecord(payload) || payload.error !== undefined) return undefined;
  const items = simklCatalogItems(payload.items, list.type).slice(0, ROW_ITEMS);
  if (!items.length) return undefined;
  return {
    id: `list-${list.id}`,
    title: list.name,
    kind: "list",
    link: `https://simkl.com/lists/${list.id}/`,
    items,
  };
}

export function trendingRow(
  source: (typeof SIMKL_TRENDING)[number],
  payload: unknown,
): SimklRow | undefined {
  const items = simklCatalogItems(payload, source.type).slice(0, ROW_ITEMS);
  return items.length
    ? { id: source.id, title: source.title, kind: "trending", link: source.link, items }
    : undefined;
}

function itemYear(value: Record<string, unknown>): number | undefined {
  if (typeof value.year === "number" && value.year > 1800 && value.year < 3000) return value.year;
  // Trending files carry US-style "MM/DD/YYYY" release dates.
  const match = typeof value.release_date === "string" ? /(\d{4})$/.exec(value.release_date) : null;
  return match ? Number(match[1]) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
