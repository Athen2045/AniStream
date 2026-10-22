import { queryOptions } from "@tanstack/react-query";
import type {
  AniListCatalogMedia,
  AniListMediaType,
  AniListPageInfo,
  AniStreamBridge,
  LatestAnimeUpdate,
  LatestMangaUpdate,
} from "../../shared/contracts";

const TRENDING_LIMIT = 20;

export type CatalogQueryApi = Pick<
  AniStreamBridge,
  "browseAniList" | "getLatestAnimeUpdates" | "getLatestMangaUpdates" | "getMalTrendingFallback"
>;

export interface LatestUpdatesResult {
  anime: LatestAnimeUpdate[];
  manga: LatestMangaUpdate[];
  pageInfo: AniListPageInfo;
}

/**
 * A section's Trending titles, kept for the app session so switching sections never reloads them.
 * AniList's empty answer is kept too: the MAL ranking stands in and AniList is not asked again.
 */
export function catalogTrendingQuery(
  type: AniListMediaType,
  api: CatalogQueryApi = window.anistream,
) {
  return queryOptions({
    queryKey: ["catalog", "trending", type] as const,
    queryFn: async (): Promise<AniListCatalogMedia[]> =>
      (
        await api.browseAniList({ type, page: 1, perPage: TRENDING_LIMIT, sort: "TRENDING_DESC" })
      ).items.slice(0, TRENDING_LIMIT),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** MyAnimeList's ranking, asked only when AniList's Trending failed or came back empty. */
export function malTrendingQuery(type: AniListMediaType, api: CatalogQueryApi = window.anistream) {
  return queryOptions({
    queryKey: ["catalog", "mal-trending", type] as const,
    queryFn: () => api.getMalTrendingFallback(type),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * One fixed provider page of Latest Updates. Each page has its own entry, so paging reloads only
 * this field; opening the section again shows the saved page while it is asked for again.
 */
export function latestUpdatesQuery(
  type: AniListMediaType,
  page: number,
  api: CatalogQueryApi = window.anistream,
) {
  return queryOptions({
    queryKey: ["catalog", "latest", type, page] as const,
    queryFn: async (): Promise<LatestUpdatesResult> => {
      if (type === "ANIME") {
        const result = await api.getLatestAnimeUpdates(page);
        return { anime: result.items, manga: [], pageInfo: result.pageInfo };
      }
      const result = await api.getLatestMangaUpdates(page);
      return { anime: [], manga: result.items, pageInfo: result.pageInfo };
    },
    // The previous page stays on screen (dimmed) while the next one loads, in the same section.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === type ? previous : undefined,
  });
}
