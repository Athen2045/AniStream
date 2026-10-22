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

export type MoreForYouApi = Pick<AniStreamBridge, "getMoreForYou">;

/** Every viewer's More For You feed; `[...moreForYouKey, viewer]` is one viewer's. */
export const moreForYouKey = ["more", "for-you"] as const;

/**
 * One viewer's More For You feed (`viewer` is the AniList account ID or "guest"), kept for the app
 * session with its local "Not interested" removals. Until a feed is shown the main process may
 * answer with its saved one; reloading a shown feed (Refresh, Undo, a finished Simkl import) asks
 * it to rebuild.
 */
export function moreForYouQuery(viewer: string, api: MoreForYouApi = window.anistream) {
  return queryOptions({
    queryKey: [...moreForYouKey, viewer] as const,
    queryFn: ({ client, queryKey }) =>
      api.getMoreForYou(client.getQueryData(queryKey) !== undefined),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
