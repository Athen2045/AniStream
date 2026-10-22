import { infiniteQueryOptions, queryOptions, type InfiniteData } from "@tanstack/react-query";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListMediaType,
  AniListSearchExtras,
  AniListSearchPerson,
  AniStreamBridge,
  MoreCatalogItem,
  MoreCatalogPage,
  MoreMediaType,
} from "../../shared/contracts";
import { moreTypesFor, type MoreBrowseFilters, type MoreSort } from "../../shared/more-filters";
import { catalogTrendingQuery } from "./catalog-queries";
import { browseInput, filterKey, type CatalogFilterState } from "./catalog-filters";
import { moreKey } from "./more-format";
import { moreTrendingQuery } from "./more-queries";
import { closestTitle } from "./search-helpers";

export type SearchScope = "ANIME" | "MANGA" | "MORE";

export type SearchResults =
  | {
      kind: "anilist";
      items: AniListCatalogMedia[];
      page: number;
      hasNext: boolean;
      extras?: AniListSearchExtras;
    }
  | {
      kind: "more";
      items: MoreCatalogItem[];
      /** Next page per type while filtered browsing has more. */
      next?: Partial<Record<MoreMediaType, number>>;
    };

type SearchApi = Pick<
  AniStreamBridge,
  | "browseAniList"
  | "browseMore"
  | "searchMore"
  | "getMoreTrending"
  | "getLatestAnimeUpdates"
  | "getLatestMangaUpdates"
  | "getMalTrendingFallback"
  | "getAniListFilterOptions"
  | "getAniListPersonTitles"
>;

const PAGE_SIZE = 30;
const TRENDING_SIZE = 16;
/** Results stay for a few minutes, so returning from a title shows them (with "more") at once. */
const RESULTS_STALE_MS = 5 * 60_000;

/** AniList's filter choices (genres, tags): asked once per app session; a failure is not kept. */
export function filterOptionsQuery(api: SearchApi = window.anistream) {
  return queryOptions({
    queryKey: ["search", "filter-options"] as const,
    queryFn: () => api.getAniListFilterOptions(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * "Trending now" under an empty field: the section's own Trending (the same cache the Anime,
 * Manga and More pages use, so opening Search asks nothing new), movies and shows alternating.
 */
export function searchTrendingQuery(scope: SearchScope, api: SearchApi = window.anistream) {
  return queryOptions({
    queryKey: ["search", "trending", scope] as const,
    queryFn: async ({ client }): Promise<SearchResults> => {
      if (scope !== "MORE") {
        const items = await client.ensureQueryData(catalogTrendingQuery(scope, api));
        return { kind: "anilist", items: items.slice(0, TRENDING_SIZE), page: 1, hasNext: false };
      }
      const [movies, shows] = await Promise.allSettled([
        client.ensureQueryData(moreTrendingQuery("MOVIE", 1, api)),
        client.ensureQueryData(moreTrendingQuery("TV", 1, api)),
      ]);
      const left = movies.status === "fulfilled" ? movies.value.items : [];
      const right = shows.status === "fulfilled" ? shows.value.items : [];
      const mixed: MoreCatalogItem[] = [];
      for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        if (left[index]) mixed.push(left[index]);
        if (right[index]) mixed.push(right[index]);
      }
      return { kind: "more", items: mixed.slice(0, TRENDING_SIZE) };
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

type ResultsPageParam = number | Partial<Record<MoreMediaType, number>>;

export interface SearchRequest {
  scope: SearchScope;
  /** The settled query ("" while only filters are set). */
  query: string;
  filters: CatalogFilterState;
  moreFilters: MoreBrowseFilters;
  /** Movies & TV with filters or a non-default sort: TMDB's filtered browse, both types. */
  moreFiltered: boolean;
}

/**
 * One search's results with "Show more" pages: AniList pages for Anime/Manga, TMDB's filtered
 * browse batches for Movies & TV with filters, or one TMDB search page per type otherwise.
 */
export function searchResultsQuery(request: SearchRequest, api: SearchApi = window.anistream) {
  const { scope, query, filters, moreFilters, moreFiltered } = request;
  return infiniteQueryOptions({
    queryKey: [
      "search",
      "results",
      scope,
      query,
      scope === "MORE" ? JSON.stringify(moreFilters) : filterKey(filters),
    ] as const,
    initialPageParam: (moreFiltered
      ? Object.fromEntries(moreTypesFor(moreFilters).map((type) => [type, 1]))
      : 1) as ResultsPageParam,
    queryFn: async ({ pageParam }): Promise<SearchResults> => {
      if (moreFiltered) {
        const pages = typeof pageParam === "number" ? {} : pageParam;
        const { items, next } = await browseMoreBatch(api, query, moreFilters, pages);
        return { kind: "more", items, next };
      }
      if (scope === "MORE") return searchMoreBoth(api, query);
      const page = typeof pageParam === "number" ? pageParam : 1;
      return toAniListResults(
        await api.browseAniList(browseInput(scope, page, PAGE_SIZE, query, filters)),
      );
    },
    getNextPageParam: (last): ResultsPageParam | undefined =>
      last.kind === "anilist"
        ? last.hasNext
          ? last.page + 1
          : undefined
        : last.next && Object.keys(last.next).length
          ? last.next
          : undefined,
    select: mergeSearchPages,
    staleTime: RESULTS_STALE_MS,
  });
}

/** Every loaded page as one list; More titles never repeat. */
export function mergeSearchPages(data: InfiniteData<SearchResults, unknown>): SearchResults {
  const [first, ...rest] = data.pages;
  if (!first) return { kind: "anilist", items: [], page: 1, hasNext: false };
  return rest.reduce<SearchResults>((merged, page) => {
    if (merged.kind === "anilist" && page.kind === "anilist")
      return {
        ...merged,
        items: [...merged.items, ...page.items],
        page: page.page,
        hasNext: page.hasNext,
      };
    if (merged.kind === "more" && page.kind === "more") {
      const seen = new Set(merged.items.map(moreKey));
      return {
        kind: "more",
        items: [...merged.items, ...page.items.filter((item) => !seen.has(moreKey(item)))],
        next: page.next,
      };
    }
    return merged;
  }, first);
}

/**
 * "Did you mean": for an Anime/Manga search that found nothing, one AniList lookup on the first
 * word by popularity; a title within two typos, or null.
 */
export function didYouMeanQuery(
  type: AniListMediaType,
  query: string,
  api: SearchApi = window.anistream,
) {
  return queryOptions({
    queryKey: ["search", "did-you-mean", type, query] as const,
    queryFn: async (): Promise<string | null> => {
      const first = query.split(/\s+/)[0] ?? "";
      const page = await api.browseAniList({
        type,
        page: 1,
        perPage: 15,
        sort: "POPULARITY_DESC",
        query: first,
      });
      return (
        closestTitle(
          query,
          page.items.map((item) => item.title),
        ) ?? null
      );
    },
    staleTime: RESULTS_STALE_MS,
  });
}

/** A studio's or voice actor's titles in one section, opened from a search. */
export function personTitlesQuery(
  person: AniListSearchPerson,
  type: AniListMediaType,
  api: SearchApi = window.anistream,
) {
  return queryOptions({
    queryKey: ["search", "person", person.kind, person.id, type] as const,
    queryFn: () => api.getAniListPersonTitles(person.kind, person.id, type),
    staleTime: RESULTS_STALE_MS,
  });
}

/** One batch of filtered More pages (one per type) merged in the chosen order. */
async function browseMoreBatch(
  api: SearchApi,
  query: string,
  filters: MoreBrowseFilters,
  pages: Partial<Record<MoreMediaType, number>>,
): Promise<{ items: MoreCatalogItem[]; next: Partial<Record<MoreMediaType, number>> }> {
  const types = (Object.keys(pages) as MoreMediaType[]).filter((type) => pages[type]);
  const responses = await Promise.allSettled(
    types.map((type) =>
      api.browseMore({
        type,
        page: pages[type]!,
        sort: filters.sort,
        ...(query ? { query } : {}),
        ...(filters.genre ? { genre: filters.genre } : {}),
        ...(filters.language ? { language: filters.language } : {}),
        ...(filters.year !== undefined ? { year: filters.year } : {}),
        ...(filters.minScore !== undefined ? { minScore: filters.minScore } : {}),
      }),
    ),
  );
  const fulfilled: Array<[MoreMediaType, MoreCatalogPage]> = [];
  responses.forEach((response, index) => {
    if (response.status === "fulfilled") fulfilled.push([types[index], response.value]);
  });
  if (!fulfilled.length) {
    const failure = responses.find((response) => response.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  const next: Partial<Record<MoreMediaType, number>> = {};
  for (const [type, page] of fulfilled)
    if (page.pageInfo.hasNextPage) next[type] = page.pageInfo.currentPage + 1;
  return {
    items: mergeMore(
      fulfilled.map(([, page]) => page.items),
      filters.sort,
    ),
    next,
  };
}

/** One TMDB search page per type, the most voted first; one failing type still shows the other. */
async function searchMoreBoth(api: SearchApi, query: string): Promise<SearchResults> {
  const responses = await Promise.allSettled([
    api.searchMore(query, "MOVIE", 1),
    api.searchMore(query, "TV", 1),
  ]);
  const fulfilled = responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value.items : [],
  );
  if (!fulfilled.length) {
    const failure = responses.find((response) => response.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  return {
    kind: "more",
    items: fulfilled.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0)),
  };
}

/** Movies and shows together: alternating for popularity, by rating or date otherwise. */
function mergeMore(lists: MoreCatalogItem[][], sort: MoreSort): MoreCatalogItem[] {
  if (sort === "rated") return lists.flat().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (sort === "newest")
    return lists.flat().sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  const mixed: MoreCatalogItem[] = [];
  for (let index = 0; index < Math.max(0, ...lists.map((list) => list.length)); index += 1)
    for (const list of lists) if (list[index]) mixed.push(list[index]);
  return mixed;
}

function toAniListResults(page: AniListCatalogPage): SearchResults {
  return {
    kind: "anilist",
    items: page.items,
    page: page.pageInfo.currentPage,
    hasNext: page.pageInfo.hasNextPage,
    extras: page.searchExtras,
  };
}
