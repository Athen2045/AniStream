import { HYBRID_WEIGHTS, recommendationSection } from "../../../shared/recommendations";
import {
  addScaled,
  compareItems,
  ContentSpace,
  DAY_MS,
  dot,
  edgeKey,
  itemKey,
  popularityPrior,
  qualityPrior,
  type Vector,
} from "./content";
import type { HybridRankInput, HybridScored } from "./types";

/**
 * Ranks candidates by provider recommendation edges from liked history (graph), IDF-weighted
 * content similarity to the viewer's taste vector, and popularity/quality priors. History from
 * other sections counts at the cross-section prior weight. Pure: callers own retrieval,
 * exclusion, and persistence.
 */
export function rankHybrid(input: HybridRankInput): HybridScored[] {
  const weights = { ...HYBRID_WEIGHTS, ...input.weights };
  const candidates = input.candidates.filter(
    (row) => recommendationSection(row.mediaType) === input.section,
  );
  const space = new ContentSpace([...input.history.map((row) => row.features), ...candidates]);
  const halfLife = weights.halfLifeDays * DAY_MS;
  const profile: Vector = new Map();
  const graph = new Map<string, { total: number; best: number; seed?: string }>();

  for (const item of input.history) {
    const decay = Math.pow(0.5, Math.max(0, input.now - item.occurredAt) / halfLife);
    const sameSection = recommendationSection(item.features.mediaType) === input.section;
    const weight = item.affinity * decay * (sameSection ? 1 : weights.crossTypePrior);
    if (!weight) continue;
    addScaled(profile, space.vector(item.features), weight);
    const edges = item.features.recommendations ?? [];
    const maxRating = Math.max(1, ...edges.map((edge) => edge.rating));
    for (const edge of edges) {
      const key = edgeKey(edge);
      const contribution = weight * (Math.log1p(edge.rating) / Math.log1p(maxRating));
      const current = graph.get(key) ?? { total: 0, best: 0 };
      current.total += contribution;
      if (contribution > current.best) {
        current.best = contribution;
        current.seed = itemKey(item.features);
      }
      graph.set(key, current);
    }
  }

  const profileNorm = Math.sqrt([...profile.values()].reduce((sum, v) => sum + v * v, 0));
  const maxGraph = Math.max(1e-9, ...[...graph.values()].map((row) => row.total));
  return candidates
    .map((features) => {
      const content =
        profileNorm > 0 ? Math.max(0, dot(profile, space.vector(features)) / profileNorm) : 0;
      const edge = graph.get(itemKey(features));
      const graphScore = Math.max(0, edge?.total ?? 0) / maxGraph;
      return {
        features,
        graph: graphScore,
        content,
        seedKey: graphScore > 0 ? edge?.seed : undefined,
        rawScore:
          weights.graph * graphScore +
          weights.content * content +
          weights.popularity * popularityPrior(features) +
          weights.quality * qualityPrior(features),
      };
    })
    .sort((a, b) => b.rawScore - a.rawScore || compareItems(a.features, b.features));
}
