/** Soft diversity and calibration for a rail: no franchise, seed or studio crowds it out. */
import type {
  RecommendationItemFeatures,
  RecommendationRelation,
} from "../../../shared/recommendations";
import { creatorKey, edgeKey, itemKey } from "./content";
import type { HybridHistoryItem, HybridScored } from "./types";

/**
 * Soft diversity (X's author-diversity scorer: (1 - floor) * decay^n + floor for the n-th repeat).
 * Repeats of a seed, a franchise or a studio fade instead of being cut off at a fixed count.
 */
const SEED_FADE = { decay: 0.6, floor: 0.35 };
const FRANCHISE_FADE = { decay: 0.4, floor: 0.15 };
const STUDIO_FADE = { decay: 0.75, floor: 0.5 };
export const MAX_PER_FRANCHISE_IN_ROW = 2;
/** Top-ranked titles the diverse selection considers. */
const SELECTION_POOL = 120;
/** Calibration smoothing (Steck's alpha): keeps unseen genres from an infinite divergence. */
const CALIBRATION_ALPHA = 0.01;

/** Relations that keep two titles in one franchise for diversity. */
const FRANCHISE_RELATIONS = new Set<RecommendationRelation["relationType"]>([
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
]);

/**
 * Gives each media type at least `min` of the picks when titles of that type rank within the
 * first `within` scored: the lowest-ranked picks of the over-represented type make room, and the
 * result stays in score order.
 */
export function balanceTypes(
  picked: HybridScored[],
  scored: HybridScored[],
  min: number,
  within = 40,
): void {
  const types = [...new Set(scored.map((row) => row.features.mediaType))];
  for (const type of types) {
    const have = picked.filter((row) => row.features.mediaType === type).length;
    if (have >= min) continue;
    const extra = scored
      .slice(0, within)
      .filter((row) => row.features.mediaType === type && !picked.includes(row))
      .slice(0, min - have);
    for (const row of extra) {
      const counts = new Map<string, number>();
      for (const pick of picked)
        counts.set(pick.features.mediaType, (counts.get(pick.features.mediaType) ?? 0) + 1);
      // Remove the lowest-ranked pick of a type that can spare one.
      let drop = -1;
      for (let index = picked.length - 1; index >= 0; index -= 1)
        if (
          picked[index].features.mediaType !== type &&
          (counts.get(picked[index].features.mediaType) ?? 0) > min
        ) {
          drop = index;
          break;
        }
      if (drop < 0) break;
      picked.splice(drop, 1);
      // The newcomer takes its score's place; the rest keep their selection order.
      const at = picked.findIndex((pick) => pick.rawScore < row.rawScore);
      picked.splice(at < 0 ? picked.length : at, 0, row);
    }
  }
}

/**
 * Franchise groups by exact relations (sequels, prequels, parents, side stories, spin-offs) and,
 * for movies, TMDB collections: two titles share a key when any chain of these links joins them.
 * Titles with no franchise link are left out.
 */
export function franchiseKeys(items: RecommendationItemFeatures[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(b)) parent.set(b, b);
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(left, right);
  };
  const linked = new Set<string>();
  for (const item of items) {
    const key = itemKey(item);
    if (!parent.has(key)) parent.set(key, key);
    for (const relation of item.relations ?? [])
      if (FRANCHISE_RELATIONS.has(relation.relationType) && relation.mediaType === item.mediaType) {
        union(key, edgeKey(relation));
        linked.add(key);
      }
    if (item.collectionId) {
      union(key, `collection:${item.collectionId}`);
      linked.add(key);
    }
  }
  const groups = new Map<string, string>();
  for (const item of items) {
    const key = itemKey(item);
    if (linked.has(key)) groups.set(key, find(key));
  }
  return groups;
}

function studioKey(item: RecommendationItemFeatures): string | undefined {
  const studio = item.creators.find(
    (creator) => creator.role === "STUDIO" || creator.role === "COMPANY",
  );
  return studio ? creatorKey(studio) : undefined;
}

function fade({ decay, floor }: { decay: number; floor: number }, repeats: number): number {
  return (1 - floor) * decay ** repeats + floor;
}

/** A genre mix from titles, each title's weight split evenly across its genres. */
function genreMix(
  items: Array<{ features: RecommendationItemFeatures; weight: number }>,
): Map<string, number> {
  const mix = new Map<string, number>();
  let total = 0;
  for (const { features, weight } of items) {
    if (weight <= 0 || !features.genres.length) continue;
    const share = weight / features.genres.length;
    for (const genre of features.genres) mix.set(genre, (mix.get(genre) ?? 0) + share);
    total += weight;
  }
  if (total > 0) for (const [genre, value] of mix) mix.set(genre, value / total);
  return mix;
}

/** KL(target || picked), with the picked mix smoothed toward the target (Steck 2018). */
function divergence(target: Map<string, number>, picked: Map<string, number>): number {
  let sum = 0;
  for (const [genre, p] of target) {
    if (p <= 0) continue;
    const q = (1 - CALIBRATION_ALPHA) * (picked.get(genre) ?? 0) + CALIBRATION_ALPHA * p;
    sum += p * Math.log(p / q);
  }
  return sum;
}

/**
 * Greedy rail selection: each step takes the title with the best faded score (repeats of a seed,
 * franchise or studio fade) blended with how well the rail then matches the genre mix the viewer
 * likes. Without calibration it is the faded score alone.
 */
export function selectDiverse(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  limit: number,
  calibrate: number,
): HybridScored[] {
  const pool = scored.slice(0, SELECTION_POOL);
  const franchise = franchiseKeys(pool.map((row) => row.features));
  const target = calibrate
    ? genreMix(history.map((row) => ({ features: row.features, weight: row.affinity })))
    : new Map<string, number>();
  const maxScore = Math.max(1e-9, ...pool.map((row) => row.rawScore));
  const picked: HybridScored[] = [];
  const seeds = new Map<string, number>();
  const franchises = new Map<string, number>();
  const studios = new Map<string, number>();
  const remaining = new Set(pool);
  const count = (map: Map<string, number>, key: string | undefined): void => {
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  while (picked.length < limit && remaining.size) {
    let best: HybridScored | undefined;
    let bestValue = -Infinity;
    for (const row of remaining) {
      const franchiseKey = franchise.get(itemKey(row.features));
      const studio = studioKey(row.features);
      const faded =
        (row.rawScore / maxScore) *
        (row.seedKey ? fade(SEED_FADE, seeds.get(row.seedKey) ?? 0) : 1) *
        (franchiseKey ? fade(FRANCHISE_FADE, franchises.get(franchiseKey) ?? 0) : 1) *
        (studio ? fade(STUDIO_FADE, studios.get(studio) ?? 0) : 1);
      let value = faded;
      if (calibrate && target.size) {
        const mix = genreMix(
          [...picked, row].map((pick) => ({ features: pick.features, weight: 1 })),
        );
        value = (1 - calibrate) * faded - calibrate * divergence(target, mix);
      }
      if (value > bestValue) {
        best = row;
        bestValue = value;
      }
    }
    if (!best) break;
    remaining.delete(best);
    picked.push(best);
    count(seeds, best.seedKey);
    count(franchises, franchise.get(itemKey(best.features)));
    count(studios, studioKey(best.features));
  }
  return picked;
}
