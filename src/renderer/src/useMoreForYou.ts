import { useCallback, useEffect, useRef, useState } from "react";
import type { MoreDiscoveryFeed, MoreRecommendation } from "../../shared/discovery";
import { friendlyRemoteError } from "./remote-error";

export interface MoreForYouState {
  feed?: MoreDiscoveryFeed;
  loading: boolean;
  error?: string;
  /** The last dismissed title, offered for Undo. */
  undo?: MoreRecommendation;
}

/**
 * The last feed shown and whose it was, so reopening More shows it at once (the main process keeps
 * the same per viewer). Another viewer never sees it.
 */
let appFeed: { viewer: string; feed: MoreDiscoveryFeed } | undefined;
const feedFor = (viewer: string): MoreDiscoveryFeed | undefined =>
  appFeed?.viewer === viewer ? appFeed.feed : undefined;

/**
 * Loads More For You once per mount and keeps "Not interested" choices local and reversible.
 * `viewer` identifies the signed-in AniList account (or the guest); a change loads that viewer's
 * picks instead of keeping the previous account's.
 */
export function useMoreForYou(
  enabled: boolean,
  viewer: string,
): MoreForYouState & {
  refresh: () => void;
  dismiss: (entry: MoreRecommendation) => void;
  undoDismiss: () => void;
} {
  const [state, setState] = useState<MoreForYouState>(() => ({
    feed: feedFor(viewer),
    loading: enabled && !feedFor(viewer),
  }));
  // The viewer this state belongs to; a feed is remembered only under it.
  const stateViewer = useRef(viewer);
  useEffect(() => {
    if (state.feed && stateViewer.current === viewer) appFeed = { viewer, feed: state.feed };
  }, [state.feed, viewer]);
  const generation = useRef(0);

  /** Resolves one request into state unless a newer request or unmount superseded it. */
  const request = useCallback((current: number, fresh: boolean) => {
    window.anistream
      .getMoreForYou(fresh)
      .then((feed) => {
        if (current === generation.current) setState({ feed, loading: false });
      })
      .catch((reason: unknown) => {
        if (current !== generation.current) return;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: friendlyRemoteError(reason, {
            provider: "TMDB",
            operation: "suggestions",
            retained: Boolean(previous.feed?.items.length),
            fallback: "Recommendations could not be loaded. Try again shortly.",
          }),
        }));
      });
  }, []);

  const refresh = useCallback(() => {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    request(current, true);
  }, [request]);

  useEffect(() => {
    const counter = generation;
    if (stateViewer.current !== viewer) {
      // Signed out or into another account: drop the previous viewer's picks and their Undo.
      stateViewer.current = viewer;
      setState({ feed: feedFor(viewer), loading: enabled && !feedFor(viewer) });
    }
    // Reopening More keeps the feed already shown (with its local "Not interested" removals).
    // Otherwise this asks for the session's or saved feed; Refresh, Undo and a finished Simkl
    // import rebuild it.
    if (enabled && !feedFor(viewer)) request(++counter.current, false);
    return () => {
      counter.current++;
    };
  }, [enabled, request, viewer]);

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

  const send = useCallback(
    (entry: MoreRecommendation, action: "dismiss" | "undo"): Promise<void> => {
      const requestId = state.feed?.requestId;
      if (!requestId) return Promise.resolve();
      return window.anistream.recordMoreDiscoveryFeedback({
        requestId,
        type: entry.item.type,
        tmdbId: entry.item.id,
        action,
      });
    },
    [state.feed?.requestId],
  );

  const dismiss = useCallback(
    (entry: MoreRecommendation) => {
      void send(entry, "dismiss")
        .then(() =>
          setState((previous) => ({
            ...previous,
            undo: entry,
            feed: previous.feed && withoutTitle(previous.feed, entry),
          })),
        )
        .catch(() =>
          setState((previous) => ({
            ...previous,
            error: "Could not save Not interested. Your recommendations are unchanged.",
          })),
        );
    },
    [send],
  );

  const undoDismiss = useCallback(() => {
    if (!state.undo) return;
    void send(state.undo, "undo")
      .then(() => {
        setState((previous) => ({ ...previous, undo: undefined }));
        refresh();
      })
      .catch(() =>
        setState((previous) => ({
          ...previous,
          error: "Could not undo this choice. Refresh and try again.",
        })),
      );
  }, [refresh, send, state.undo]);

  return { ...state, refresh, dismiss, undoDismiss };
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
