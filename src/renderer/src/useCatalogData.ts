import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaType,
  AniListPageInfo,
  LatestAnimeUpdate,
  LatestMangaUpdate,
  MalRankingItem,
} from "../../shared/contracts";
import { catalogTrendingQuery, latestUpdatesQuery, malTrendingQuery } from "./catalog-queries";
import { friendlyRemoteError } from "./remote-error";

export interface UseCatalogDataInput {
  type: AniListMediaType;
  /** Load the Latest Updates grid (default true). */
  latest?: boolean;
}

export interface CatalogData {
  latestPage: number;
  trending: AniListCatalogMedia[];
  malTrendingFallback: MalRankingItem[];
  trendingLoading: boolean;
  latestAnime: LatestAnimeUpdate[];
  latestManga: LatestMangaUpdate[];
  latestPageInfo?: AniListPageInfo;
  latestLoading: boolean;
  latestError?: string;
  error?: string;
  setLatestPage(page: number): void;
}

const NO_TITLES: never[] = [];

/** Trending (with the MAL stand-in) and Latest Updates for one section (`catalog-queries.ts`). */
export function useCatalogData({ type, latest = true }: UseCatalogDataInput): CatalogData {
  // Latest Updates start on page 1 in each section.
  const [latestAt, setLatestAt] = useState({ type, page: 1 });
  const latestPage = latestAt.type === type ? latestAt.page : 1;
  const setLatestPage = useCallback((page: number) => setLatestAt({ type, page }), [type]);

  const trendingQuery = useQuery(catalogTrendingQuery(type));
  const needsFallback = trendingQuery.isError || trendingQuery.data?.length === 0;
  const fallbackQuery = useQuery({ ...malTrendingQuery(type), enabled: needsFallback });
  const latestQuery = useQuery({ ...latestUpdatesQuery(type, latestPage), enabled: latest });

  const latestResult = latestQuery.data;
  return {
    latestPage,
    setLatestPage,
    trending: trendingQuery.data ?? NO_TITLES,
    malTrendingFallback: (needsFallback && fallbackQuery.data) || NO_TITLES,
    trendingLoading: trendingQuery.isPending,
    latestAnime: latestResult?.anime ?? NO_TITLES,
    latestManga: latestResult?.manga ?? NO_TITLES,
    latestPageInfo: latestResult?.pageInfo,
    latestLoading: latestQuery.isFetching || (latest && latestQuery.isPending),
    latestError: latestQuery.error
      ? friendlyRemoteError(latestQuery.error, {
          provider: type === "ANIME" ? "AniList" : "MangaDex",
          operation: `latest ${type.toLowerCase()} updates`,
          retained: Boolean(latestResult?.anime.length || latestResult?.manga.length),
          fallback: `Latest ${type.toLowerCase()} updates are unavailable right now. Try again shortly.`,
        })
      : undefined,
    // The AniList error stays the primary message even when the MAL ranking stands in.
    error: trendingQuery.error
      ? friendlyRemoteError(trendingQuery.error, {
          provider: "AniList",
          operation: "trending titles",
          fallback: "Trending titles are unavailable right now. Try again shortly.",
        })
      : undefined,
  };
}
