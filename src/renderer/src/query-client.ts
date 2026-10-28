import { QueryClient } from "@tanstack/react-query";

/**
 * Factory for the window's React Query cache (tests make their own). The main process already
 * paces, retries and stops on 429/403, so queries never retry here, and nothing refetches just
 * because the window regains focus or the network returns. Each query sets its own lifetimes.
 * Queries always run, also offline: they ask the main process, which answers from saved copies or
 * says it is offline (React Query's default would hold them as loading until reconnect).
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: "always",
      },
      mutations: { networkMode: "always" },
    },
  });
}

/** The window's one cache, shared by every section. */
export const appQueryClient = createAppQueryClient();

/** After "online": the first reload, then one more for what still failed (Windows can report
 * the connection a moment before it carries traffic). */
export const RECONNECT_RELOAD_MS = [1_000, 6_000] as const;

/**
 * Back online: what failed while offline and is still on screen loads again by itself. Only the
 * failed queries, so a reconnect never refreshes every section at once.
 */
export function refetchFailedOnReconnect(
  client: QueryClient,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  delays: readonly number[] = RECONNECT_RELOAD_MS,
): () => void {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const reloadFailed = (): void => {
    void client.refetchQueries({
      type: "active",
      predicate: (query) => query.state.status === "error",
    });
  };
  const onOnline = (): void => {
    timers.forEach(clearTimeout);
    timers = delays.map((ms) => setTimeout(reloadFailed, ms));
  };
  target.addEventListener("online", onOnline);
  return () => {
    timers.forEach(clearTimeout);
    target.removeEventListener("online", onOnline);
  };
}
