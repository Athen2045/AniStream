import type { AniListMediaType, AniStreamBridge } from "../../shared/contracts";
import type { DiscoveryFeed, DiscoveryFeedback } from "../../shared/discovery";
import type { RecommendationResult } from "../../shared/recommendations";
import { friendlyRemoteError } from "./remote-error";

type Bridge = Pick<
  AniStreamBridge,
  "getForYou" | "recordDiscoveryFeedback" | "recordDiscoveryImpressions"
>;
export interface DiscoverySnapshot {
  feed?: DiscoveryFeed;
  loading: boolean;
  busy: boolean;
  error?: string;
  undo?: DiscoveryFeedback;
}
interface DiscoverySessionOptions {
  requestTimeoutMs?: number;
}
const DEFAULT_REQUEST_TIMEOUT_MS = 14_000;

export function createDiscoverySession(
  type: AniListMediaType,
  bridge?: Bridge,
  options: DiscoverySessionOptions = {},
) {
  const api = (): Bridge => bridge ?? window.anistream;
  // The rail is loaded lazily when it approaches the viewport. Keep its manual refresh
  // available before that observer fires instead of presenting an endless "Checking" state.
  let snapshot: DiscoverySnapshot = { loading: false, busy: false };
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const impressions = new Set<string>();
  let flight: Promise<void> | undefined;
  const notify = (changes: Partial<DiscoverySnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  };
  const load = async (): Promise<void> => {
    if (disposed || snapshot.busy) return;
    if (flight) return flight;
    const current = ++generation;
    notify({ loading: true, error: undefined });
    const request = (async () => {
      try {
        const feed = await withTimeout(
          api().getForYou(type),
          options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        );
        if (disposed || current !== generation) return;
        const retained = Boolean(snapshot.feed?.items.length);
        const providerError =
          feed.status === "unavailable"
            ? friendlyRemoteError(new Error(feed.message ?? ""), {
                provider: "AniList",
                operation: "suggestions",
                retained,
                fallback: retained
                  ? "Recommendations could not be refreshed. Your previous suggestions remain available."
                  : "Recommendations are unavailable right now. Try again shortly.",
              })
            : undefined;
        if (feed.status === "unavailable" && retained) {
          notify({ loading: false, error: providerError });
        } else notify({ feed, loading: false, error: providerError });
      } catch (reason) {
        if (current === generation) {
          const retained = Boolean(snapshot.feed?.items.length);
          notify({
            loading: false,
            error: friendlyRemoteError(reason, {
              provider: "AniList",
              operation: "suggestions",
              retained,
              fallback: retained
                ? "Recommendations could not be refreshed. Your previous suggestions remain available."
                : "Recommendations could not be loaded. Try again shortly.",
            }),
          });
        }
      }
    })();
    flight = request;
    const clearFlight = (): void => {
      if (flight === request) flight = undefined;
    };
    void request.then(clearFlight, clearFlight);
    return request;
  };
  return {
    activate() {
      disposed = false;
      notify({ busy: false });
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    async explore(item: RecommendationResult): Promise<void> {
      const requestId = snapshot.feed?.requestId;
      if (!requestId) return;
      try {
        await api().recordDiscoveryFeedback({
          requestId,
          anilistId: item.anilistId,
          action: "explore",
        });
      } catch {
        /* Opening a title must work even when local feedback is unavailable. */
      }
    },
    async dismiss(item: RecommendationResult): Promise<void> {
      const requestId = snapshot.feed?.requestId;
      if (!requestId || snapshot.busy || disposed) return;
      const current = ++generation;
      notify({ busy: true, loading: false, error: undefined });
      try {
        await api().recordDiscoveryFeedback({
          requestId,
          anilistId: item.anilistId,
          action: "dismiss",
        });
        if (disposed || current !== generation) return;
        notify({
          feed: snapshot.feed
            ? {
                ...snapshot.feed,
                items: snapshot.feed.items.filter((row) => row.anilistId !== item.anilistId),
              }
            : undefined,
          undo: { requestId, anilistId: item.anilistId, action: "undo" },
        });
      } catch {
        if (current === generation)
          notify({ error: "Could not save Not interested. Your recommendations are unchanged." });
      } finally {
        if (current === generation) notify({ busy: false });
      }
    },
    async undo(): Promise<void> {
      if (!snapshot.undo || snapshot.busy || disposed) return;
      const current = ++generation;
      notify({ busy: true, error: undefined });
      try {
        await api().recordDiscoveryFeedback(snapshot.undo);
        if (disposed || current !== generation) return;
        notify({ undo: undefined, busy: false });
        await load();
      } catch {
        if (current === generation)
          notify({
            busy: false,
            error: "Could not undo this choice. Refresh For You and try again.",
          });
      }
    },
    async visible(item: RecommendationResult): Promise<void> {
      const requestId = snapshot.feed?.requestId;
      if (!requestId || disposed) return;
      const key = `${requestId}:${item.anilistId}`;
      if (impressions.has(key)) return;
      impressions.add(key);
      try {
        await api().recordDiscoveryImpressions({ requestId, anilistIds: [item.anilistId] });
      } catch {
        impressions.delete(key);
      }
    },
    dispose() {
      disposed = true;
      generation++;
      flight = undefined;
      listeners.clear();
      impressions.clear();
    },
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
