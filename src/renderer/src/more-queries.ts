import { queryOptions } from "@tanstack/react-query";
import type { AniStreamBridge, MoreMediaType } from "../../shared/contracts";

export type MoreTrendingApi = Pick<AniStreamBridge, "getMoreTrending">;

/** Every More Trending page, home rails (page 1) and the Movies/Shows grids alike. */
export const moreTrendingKey = ["more", "trending"] as const;

/**
 * One Trending page. Kept for the whole app session: the main process already shows a saved copy
 * and refreshes it in the background for the next launch, so returning to More never reloads.
 */
export function moreTrendingQuery(
  type: MoreMediaType,
  page: number,
  api: MoreTrendingApi = window.anistream,
) {
  return queryOptions({
    queryKey: [...moreTrendingKey, type, page] as const,
    queryFn: () => api.getMoreTrending(type, page),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
