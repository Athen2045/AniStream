import type { RecommendationItemFeatures } from "../../../shared/recommendations";
import { addScaled, compareItems, ContentSpace, dot, itemKey, type Vector } from "./content";
import type { HybridHistoryItem } from "./types";

/**
 * Candidate retrieval from the local feature cache by taste (a small on-device stand-in for the
 * retrieval stage of X and YouTube): the cached titles closest to the liked titles, pushed away
 * from disliked ones. No provider requests.
 */
export function tasteRetrieval(
  history: HybridHistoryItem[],
  pool: RecommendationItemFeatures[],
  limit: number,
): RecommendationItemFeatures[] {
  if (!pool.length || !history.length) return [];
  const space = new ContentSpace([...history.map((row) => row.features), ...pool]);
  const profile: Vector = new Map();
  for (const row of history)
    addScaled(
      profile,
      space.vector(row.features),
      row.affinity > 0 ? row.affinity : row.affinity * 0.5,
    );
  const known = new Set(history.map((row) => itemKey(row.features)));
  return pool
    .filter((item) => !known.has(itemKey(item)))
    .map((item) => ({ item, similarity: dot(profile, space.vector(item)) }))
    .filter(({ similarity }) => similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || compareItems(a.item, b.item))
    .slice(0, limit)
    .map(({ item }) => item);
}
