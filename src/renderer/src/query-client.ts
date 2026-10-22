import { QueryClient } from "@tanstack/react-query";

/**
 * Factory for the window's React Query cache (tests make their own). The main process already
 * paces, retries and stops on 429/403, so queries never retry here, and nothing refetches just
 * because the window regains focus or the network returns. Each query sets its own lifetimes.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

/** The window's one cache, shared by every section. */
export const appQueryClient = createAppQueryClient();
