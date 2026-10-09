import type { MoreMediaType, MorePlayerSource } from "../../shared/contracts";

const MAX_REMEMBERED_TITLES = 200;

/**
 * Per-title choice of More player for this app session. When the primary player has no source for
 * a title, the next configured player is tried; the one that was switched to is remembered so
 * reopening that title does not wait on the failing player again. Nothing here is persisted.
 */
export function createMorePlayerFallbackMemory(): {
  /** Configured player index to start with for this title (0 = primary). */
  initial(tmdbId: number, type: MoreMediaType): number;
  remember(tmdbId: number, type: MoreMediaType, providerIndex: number): void;
  forget(tmdbId: number, type: MoreMediaType): void;
} {
  const chosen = new Map<string, number>();
  const key = (tmdbId: number, type: MoreMediaType): string => `${type}:${tmdbId}`;
  return {
    initial: (tmdbId, type) => chosen.get(key(tmdbId, type)) ?? 0,
    remember(tmdbId, type, providerIndex) {
      const id = key(tmdbId, type);
      chosen.delete(id);
      if (providerIndex <= 0) return;
      chosen.set(id, providerIndex);
      // Oldest-first eviction keeps the session memory bounded.
      if (chosen.size > MAX_REMEMBERED_TITLES) chosen.delete(chosen.keys().next().value!);
    },
    forget(tmdbId, type) {
      chosen.delete(key(tmdbId, type));
    },
  };
}

export const morePlayerFallbacks = createMorePlayerFallbackMemory();

/** The next configured player after a failure, or undefined when every player has been tried. */
export function nextMorePlayerAfterFailure(
  source: Pick<MorePlayerSource, "providerIndex" | "providerCount">,
  startedAt: number,
): number | undefined {
  const next = (source.providerIndex + 1) % source.providerCount;
  return next === startedAt ? undefined : next;
}

/** Manual "Switch player": the next configured player, wrapping back to the primary. */
export function nextMorePlayerManually(
  source: Pick<MorePlayerSource, "providerIndex" | "providerCount">,
): number {
  return (source.providerIndex + 1) % source.providerCount;
}
