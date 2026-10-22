import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { MoreDiscoveryFeed, MoreRecommendation } from "../../shared/discovery";
import { moreForYouKey, moreForYouQuery } from "./more-queries";
import { friendlyRemoteError } from "./remote-error";

export interface MoreForYouState {
  feed?: MoreDiscoveryFeed;
  loading: boolean;
  error?: string;
  /** The last dismissed title, offered for Undo. */
  undo?: MoreRecommendation;
}

/**
 * More For You for one viewer (`more-queries.ts`), with "Not interested" choices local and
 * reversible. `viewer` identifies the signed-in AniList account (or the guest); a change shows that
 * viewer's picks and drops the previous account's.
 */
export function useMoreForYou(
  enabled: boolean,
  viewer: string,
): MoreForYouState & {
  refresh: () => void;
  dismiss: (entry: MoreRecommendation) => void;
  undoDismiss: () => void;
} {
  const queryClient = useQueryClient();
  const options = moreForYouQuery(viewer);
  const query = useQuery({ ...options, enabled });
  const feed = query.data;
  const { refetch } = query;

  // Signed out or into another account: no other viewer's picks stay in memory.
  useEffect(() => {
    queryClient.removeQueries({
      queryKey: moreForYouKey,
      predicate: (other) => other.queryKey[2] !== viewer,
    });
  }, [queryClient, viewer]);

  // Undo belongs to the viewer who dismissed the title and to this visit of More.
  const [undoState, setUndoState] = useState<{ viewer: string; entry: MoreRecommendation }>();
  const undo = undoState?.viewer === viewer ? undoState.entry : undefined;

  const send = (entry: MoreRecommendation, action: "dismiss" | "undo"): Promise<void> => {
    const requestId = feed?.requestId;
    if (!requestId) return Promise.resolve();
    return window.anistream.recordMoreDiscoveryFeedback({
      requestId,
      type: entry.item.type,
      tmdbId: entry.item.id,
      action,
    });
  };
  const dismissal = useMutation({
    mutationFn: (entry: MoreRecommendation) => send(entry, "dismiss"),
    onSuccess: (_result, entry) => {
      queryClient.setQueryData(options.queryKey, (current) =>
        current ? withoutTitle(current, entry) : current,
      );
      setUndoState({ viewer, entry });
    },
  });
  const restoral = useMutation({
    mutationFn: (entry: MoreRecommendation) => send(entry, "undo"),
    onSuccess: () => {
      setUndoState(undefined);
      void refetch();
    },
  });
  const { reset: resetDismissal } = dismissal;
  const { reset: resetRestoral } = restoral;

  const refresh = useCallback(() => {
    resetDismissal();
    resetRestoral();
    void refetch();
  }, [refetch, resetDismissal, resetRestoral]);

  // A finished Simkl import changes the evidence, so the picks reload once it lands.
  useEffect(() => {
    if (!enabled) return;
    let syncing = false;
    return window.anistream.onSimklStatusChanged((status) => {
      const now = Boolean(status.library?.syncing);
      if (syncing && !now && !status.library?.error) refresh();
      syncing = now;
    });
  }, [enabled, refresh]);

  const error = restoral.isError
    ? "Could not undo this choice. Refresh and try again."
    : dismissal.isError
      ? "Could not save Not interested. Your recommendations are unchanged."
      : query.error && !query.isFetching
        ? friendlyRemoteError(query.error, {
            provider: "TMDB",
            operation: "suggestions",
            retained: Boolean(feed?.items.length),
            fallback: "Recommendations could not be loaded. Try again shortly.",
          })
        : undefined;

  return {
    feed,
    loading: query.isFetching,
    error,
    undo,
    refresh,
    dismiss: (entry) => dismissal.mutate(entry),
    undoDismiss: () => {
      if (undo) restoral.mutate(undo);
    },
  };
}

function withoutTitle(feed: MoreDiscoveryFeed, entry: MoreRecommendation): MoreDiscoveryFeed {
  const keep = (row: MoreRecommendation): boolean =>
    row.item.type !== entry.item.type || row.item.id !== entry.item.id;
  return {
    ...feed,
    items: feed.items.filter(keep),
    rows: feed.rows?.map((row) => ({ ...row, items: row.items.filter(keep) })),
  };
}
