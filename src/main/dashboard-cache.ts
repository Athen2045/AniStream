import type { AniListDashboard, AniListEntry } from "../shared/contracts";

/** The offline copy of the AniList library stays small enough for one SQLite row. */
export const DASHBOARD_CACHE_LIMIT = 2_000_000;

const STATUS_PRIORITY: Record<string, number> = {
  CURRENT: 0,
  REPEATING: 0,
  PAUSED: 1,
  PLANNING: 2,
  COMPLETED: 3,
  DROPPED: 4,
};

/**
 * Serializes the dashboard for the offline copy. A library too large for the limit keeps the
 * titles Continue and Profile need most (watching/reading first, then the most recently updated
 * others) instead of failing, so offline mode scales with any library size. Returns undefined
 * only when even the in-progress titles cannot fit.
 */
export function serializeDashboardForCache(
  dashboard: AniListDashboard,
  limit = DASHBOARD_CACHE_LIMIT,
): string | undefined {
  const full = JSON.stringify(dashboard);
  if (full.length <= limit) return full;

  // Custom lists repeat entries; rank each list entry once.
  const unique = new Map<AniListEntry["id"], AniListEntry>();
  for (const group of [...dashboard.animeLists, ...dashboard.mangaLists])
    for (const entry of group.entries) unique.set(entry.id, entry);
  const ranked = [...unique.values()].sort(
    (a, b) =>
      (STATUS_PRIORITY[a.status] ?? 5) - (STATUS_PRIORITY[b.status] ?? 5) ||
      b.updatedAt - a.updatedAt,
  );
  const serialize = (count: number): string => {
    const keep = new Set<AniListEntry["id"]>(ranked.slice(0, count).map((entry) => entry.id));
    const trim = (groups: AniListDashboard["animeLists"]) =>
      groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => keep.has(entry.id)),
        }))
        .filter((group) => group.entries.length);
    return JSON.stringify({
      ...dashboard,
      animeLists: trim(dashboard.animeLists),
      mangaLists: trim(dashboard.mangaLists),
    });
  };

  // Largest entry count that fits, by binary search over the ranked entries.
  let low = 0;
  let high = ranked.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (serialize(middle).length <= limit) low = middle;
    else high = middle - 1;
  }
  const inProgress = ranked.filter((entry) => (STATUS_PRIORITY[entry.status] ?? 5) === 0).length;
  return low >= inProgress ? serialize(low) : undefined;
}
