import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import type { AniListMediaType } from "../../shared/contracts";
import type { DiscoveryFeed, DiscoveryFeedback } from "../../shared/discovery";
import type { RecommendationResult } from "../../shared/recommendations";
import {
  ForYouUnavailableError,
  forYouKey,
  forYouQuery,
  forYouUndoQuery,
  withoutForYouTitle,
} from "./for-you-queries";
import { friendlyRemoteError } from "./remote-error";

export interface ForYou {
  feed?: DiscoveryFeed;
  loading: boolean;
  /** A Not interested or Undo choice is being saved. */
  busy: boolean;
  error?: string;
  undo?: DiscoveryFeedback;
  /** Rebuilds the feed. */
  refresh(): void;
  /** Loads unless a feed arrived within `maxAgeMs`. */
  ensure(maxAgeMs: number): void;
  dismiss(item: RecommendationResult): void;
  undoDismiss(): void;
  /** Records that a title was opened from the feed. */
  explore(item: RecommendationResult): void;
  /** Records that a card was seen (once per feed and title). */
  visible(item: RecommendationResult): void;
}

/** Cards already reported as seen, by feed request and title. */
const impressions = new Set<string>();

/**
 * Anime/Manga For You for one section and viewer (`for-you-queries.ts`), shared by the page's hero
 * and rail. `viewer` is the AniList account ID or "guest"; other viewers' feeds are dropped.
 */
export function useForYou(type: AniListMediaType, viewer: string, enabled: boolean): ForYou {
  const queryClient = useQueryClient();
  const options = forYouQuery(type, viewer);
  const { queryKey } = options;
  const query = useQuery({ ...options, enabled });
  const { refetch } = query;
  const feed = query.data;
  const undoKey = forYouUndoQuery(type, viewer).queryKey;
  const undo = useQuery(forYouUndoQuery(type, viewer)).data ?? undefined;

  // Signed out or into another account: no other viewer's feeds stay in memory.
  useEffect(() => {
    queryClient.removeQueries({
      queryKey: forYouKey,
      predicate: (other) => other.queryKey[3] !== viewer,
    });
  }, [queryClient, viewer]);

  const dismissal = useMutation({
    mutationFn: async (input: DiscoveryFeedback) => {
      // A load still running would bring the title back.
      await queryClient.cancelQueries({ queryKey });
      await window.anistream.recordDiscoveryFeedback(input);
    },
    onSuccess: (_result, input) => {
      // Keeps the feed's age, so activity still rebuilds it after a minute.
      const loadedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt;
      queryClient.setQueryData(
        queryKey,
        (current) => current && withoutForYouTitle(current, input.anilistId),
        { updatedAt: loadedAt },
      );
      const offer: DiscoveryFeedback = { ...input, action: "undo" };
      queryClient.setQueryData(undoKey, () => offer);
    },
  });
  const restoral = useMutation({
    mutationFn: (input: DiscoveryFeedback) => window.anistream.recordDiscoveryFeedback(input),
    onSuccess: () => {
      queryClient.setQueryData(undoKey, null);
      void refetch({ cancelRefetch: false });
    },
  });
  const busy = dismissal.isPending || restoral.isPending;
  const { reset: resetDismissal } = dismissal;
  const { reset: resetRestoral } = restoral;

  const refresh = useCallback(() => {
    if (busy) return;
    resetDismissal();
    resetRestoral();
    void refetch({ cancelRefetch: false });
  }, [busy, refetch, resetDismissal, resetRestoral]);

  const ensure = useCallback(
    (maxAgeMs: number) => {
      if (!enabled || busy) return;
      const state = queryClient.getQueryState(forYouQuery(type, viewer).queryKey);
      if (state?.fetchStatus === "fetching") return;
      if (state?.data !== undefined && Date.now() - state.dataUpdatedAt < maxAgeMs) return;
      void refetch({ cancelRefetch: false });
    },
    [busy, enabled, queryClient, refetch, type, viewer],
  );

  const retained = Boolean(feed?.items.length);
  const error = restoral.isError
    ? "Could not undo this choice. Refresh For You and try again."
    : dismissal.isError
      ? "Could not save Not interested. Your recommendations are unchanged."
      : query.isFetching
        ? undefined
        : query.error instanceof ForYouUnavailableError
          ? friendlyRemoteError(query.error, {
              provider: "AniList",
              operation: "suggestions",
              retained: true,
              fallback:
                "Recommendations could not be refreshed. Your previous suggestions remain available.",
            })
          : query.error
            ? friendlyRemoteError(query.error, {
                provider: "AniList",
                operation: "suggestions",
                retained,
                fallback: retained
                  ? "Recommendations could not be refreshed. Your previous suggestions remain available."
                  : "Recommendations could not be loaded. Try again shortly.",
              })
            : feed?.status === "unavailable"
              ? friendlyRemoteError(new Error(feed.message ?? ""), {
                  provider: "AniList",
                  operation: "suggestions",
                  retained: false,
                  fallback: "Recommendations are unavailable right now. Try again shortly.",
                })
              : undefined;

  const requestId = feed?.requestId;
  return {
    feed: enabled ? feed : undefined,
    loading: query.isFetching,
    busy,
    error,
    undo,
    refresh,
    ensure,
    dismiss: (item) => {
      if (!requestId || busy) return;
      dismissal.mutate({ requestId, anilistId: item.anilistId, action: "dismiss" });
    },
    undoDismiss: () => {
      if (undo && !busy) restoral.mutate(undo);
    },
    explore: (item) => {
      if (!requestId) return;
      // Opening a title must work even when local feedback is unavailable.
      window.anistream
        .recordDiscoveryFeedback({ requestId, anilistId: item.anilistId, action: "explore" })
        .catch(() => undefined);
    },
    visible: (item) => {
      if (!requestId) return;
      const key = `${requestId}:${item.anilistId}`;
      if (impressions.has(key)) return;
      impressions.add(key);
      window.anistream
        .recordDiscoveryImpressions({ requestId, anilistIds: [item.anilistId] })
        .catch(() => impressions.delete(key));
    },
  };
}
