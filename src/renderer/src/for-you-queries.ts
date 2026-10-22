import { queryOptions } from "@tanstack/react-query";
import type { AniListMediaType, AniStreamBridge } from "../../shared/contracts";
import type { DiscoveryFeed, DiscoveryFeedback } from "../../shared/discovery";

export type ForYouApi = Pick<AniStreamBridge, "getForYou">;

/** Every Anime/Manga For You entry: `[…, "feed" | "undo", type, viewer]`. */
export const forYouKey = ["for-you"] as const;

const REQUEST_TIMEOUT_MS = 14_000;

/** AniList could not rebuild the feed; the suggestions already shown stay. */
export class ForYouUnavailableError extends Error {
  public override readonly name = "ForYouUnavailableError";
}

/**
 * One section's For You feed for one viewer (the AniList account ID or "guest"), shared by the
 * page's hero and rail and kept for the app session with its local "Not interested" removals.
 * Until a feed is shown the main process may answer with its saved one; reloading a shown feed
 * asks it to rebuild.
 */
export function forYouQuery(
  type: AniListMediaType,
  viewer: string,
  api: ForYouApi = window.anistream,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  return queryOptions({
    queryKey: [...forYouKey, "feed", type, viewer] as const,
    queryFn: async ({ client, queryKey }): Promise<DiscoveryFeed> => {
      const shown = client.getQueryData<DiscoveryFeed>(queryKey);
      const feed = await withTimeout(api.getForYou(type, shown !== undefined), timeoutMs);
      if (feed.status === "unavailable" && shown?.items.length)
        throw new ForYouUnavailableError(feed.message ?? "");
      return feed;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * The Undo offer for the last "Not interested" in that feed. It lives in the cache next to the feed
 * so it survives a section switch, like the feed; it is only ever written, never fetched.
 */
export function forYouUndoQuery(type: AniListMediaType, viewer: string) {
  return queryOptions({
    queryKey: [...forYouKey, "undo", type, viewer] as const,
    queryFn: (): DiscoveryFeedback | null => null,
    initialData: null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** The feed without one dismissed title, in the main rail and every row. */
export function withoutForYouTitle(feed: DiscoveryFeed, anilistId: number): DiscoveryFeed {
  return {
    ...feed,
    items: feed.items.filter((row) => row.anilistId !== anilistId),
    rows: feed.rows?.map((row) => ({
      ...row,
      items: row.items.filter((entry) => entry.anilistId !== anilistId),
    })),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => {
        const error = new Error("The recommendation request timed out.");
        error.name = "TimeoutError";
        reject(error);
      },
      Math.max(1, timeoutMs),
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
