import {
  FEATURE_PROPAGATION_WEIGHTS,
  RANKING_WEIGHTS,
  type RecommendationCandidate,
  type RecommendationItemFeatures,
  type RecommendationProfile,
  type RecommendationProfileFeatureKind,
  type RecommendationReasonCode,
  type RecommendationResult,
  type ScoredRecommendationCandidate,
} from "../../shared/recommendations";
import { profileFeatureKey } from "./profile";

const DAY_MS = 86_400_000;

export function scoreRecommendationCandidate(
  candidate: RecommendationCandidate,
  profile: RecommendationProfile,
  now: number,
): ScoredRecommendationCandidate {
  const { features } = candidate;
  const preferenceMatch = preferenceScore(features, profile);
  const relationMatch = clamp(candidate.relationStrength ?? 0);
  const creatorMatch = creatorScore(features, profile);
  const qualitySignal = qualityScore(features);
  const mediaTypeFit = mediaTypeScore(features, profile);
  const freshness = freshnessScore(features, now);
  const explorationBonus = explorationScore(features, profile);
  const rawScore =
    preferenceMatch * RANKING_WEIGHTS.preferenceMatch +
    relationMatch * RANKING_WEIGHTS.relationMatch +
    creatorMatch * RANKING_WEIGHTS.creatorMatch +
    qualitySignal * RANKING_WEIGHTS.qualitySignal +
    mediaTypeFit * RANKING_WEIGHTS.mediaTypeFit +
    freshness * RANKING_WEIGHTS.freshness +
    explorationBonus * RANKING_WEIGHTS.explorationBonus;
  const result: RecommendationResult = {
    anilistId: features.anilistId,
    mediaType: features.mediaType,
    malId: features.malId,
    title: features.normalizedTitle,
    coverUrl: features.coverUrl,
    score: roundScore(rawScore * 100),
    reasonCodes: reasonCodes(features, profile, candidate),
    relatedTo: candidate.relatedTo,
  };
  return { ...result, candidate, rawScore };
}

export function filterRecommendationCandidates(
  candidates: RecommendationCandidate[],
  excludedIds: ReadonlySet<number>,
): RecommendationCandidate[] {
  const seen = new Set<number>();
  return candidates.filter((candidate) => {
    const id = candidate.features.anilistId;
    if (
      seen.has(id) ||
      excludedIds.has(id) ||
      candidate.completed ||
      candidate.current ||
      candidate.dismissed
    ) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

export function selectRecommendations(
  scored: ScoredRecommendationCandidate[],
  limit = 10,
): RecommendationResult[] {
  const remaining = [...scored].sort(compareScored);
  const selected: ScoredRecommendationCandidate[] = [];
  const tagCounts = new Map<string, number>();
  const creatorCounts = new Map<string, number>();
  while (remaining.length && selected.length < limit) {
    let selectedIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (
        isMoreDiverse(
          remaining[index],
          remaining[selectedIndex],
          selected,
          tagCounts,
          creatorCounts,
        )
      ) {
        selectedIndex = index;
      }
    }
    const [next] = remaining.splice(selectedIndex, 1);
    selected.push(next);
    for (const tag of next.candidate.features.tags)
      tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
    for (const creator of next.candidate.features.creators)
      creatorCounts.set(creator.name, (creatorCounts.get(creator.name) ?? 0) + 1);
  }
  return selected.map(({ candidate: _candidate, rawScore: _rawScore, ...result }) => result);
}

function preferenceScore(item: RecommendationItemFeatures, profile: RecommendationProfile): number {
  const values = featureValues(item);
  let positive = 0;
  let negative = 0;
  for (const [kind, list] of values) {
    for (const value of list) {
      const feature = profile.features[profileFeatureKey(kind, value)];
      if (!feature) continue;
      const propagation = propagationWeight(kind);
      positive += feature.positiveWeight * propagation;
      negative += feature.negativeWeight * propagation;
    }
  }
  return clamp((positive - negative * 1.15) / 3);
}

function creatorScore(item: RecommendationItemFeatures, profile: RecommendationProfile): number {
  const creatorMatches = item.creators.filter((creator) =>
    positiveFeature(profile, "creator", creator.name),
  );
  return clamp(creatorMatches.length / Math.max(1, item.creators.length));
}

function qualityScore(item: RecommendationItemFeatures): number {
  const aniList = clamp((item.averageScore ?? 0) / 100);
  const mal =
    item.malScore === undefined
      ? aniList
      : clamp(item.malScore <= 10 ? item.malScore / 10 : item.malScore / 100);
  const popularity = clamp(Math.log10(Math.max(1, item.popularity ?? 1)) / 7);
  return clamp(aniList * 0.65 + mal * 0.2 + popularity * 0.15);
}

function mediaTypeScore(item: RecommendationItemFeatures, profile: RecommendationProfile): number {
  return item.mediaType === "ANIME"
    ? profile.preferredMediaMix.anime
    : profile.preferredMediaMix.manga;
}

function freshnessScore(item: RecommendationItemFeatures, now: number): number {
  return Math.exp(-Math.max(0, now - item.updatedAt) / (365 * DAY_MS));
}

function explorationScore(
  item: RecommendationItemFeatures,
  profile: RecommendationProfile,
): number {
  const known = featureValues(item).reduce(
    (sum, [kind, values]) =>
      sum + values.filter((value) => profile.features[profileFeatureKey(kind, value)]).length,
    0,
  );
  return known === 0 ? 1 : 1 / (known + 1);
}

function reasonCodes(
  item: RecommendationItemFeatures,
  profile: RecommendationProfile,
  candidate: RecommendationCandidate,
): RecommendationReasonCode[] {
  const reasons: RecommendationReasonCode[] = [];
  const values = featureValues(item);
  if (
    values.some(
      ([kind, list]) =>
        kind === "tag" && list.some((value) => positiveFeature(profile, kind, value)),
    )
  )
    reasons.push("matches-tag");
  if (
    values.some(
      ([kind, list]) =>
        kind === "genre" && list.some((value) => positiveFeature(profile, kind, value)),
    )
  )
    reasons.push("matches-genre");
  if (candidate.relatedTo !== undefined) reasons.push("similar-to");
  if (creatorScore(item, profile) > 0) reasons.push("same-creator");
  if ((item.averageScore ?? 0) >= 80) reasons.push("highly-rated");
  if (!reasons.length || (reasons.length === 1 && reasons[0] === "highly-rated"))
    reasons.push("explore-more");
  return reasons.slice(0, 3);
}

function featureValues(
  item: RecommendationItemFeatures,
): Array<[RecommendationProfileFeatureKind, string[]]> {
  return [
    ["tag", item.tags.map((tag) => tag.name)],
    ["genre", item.genres],
    ["creator", item.creators.map((creator) => creator.name)],
    ["title-token", [...item.titleTokens, ...item.synonyms]],
    ["format", [item.mediaType === "ANIME" ? "anime" : "manga"]],
  ];
}

function propagationWeight(kind: RecommendationProfileFeatureKind): number {
  if (kind === "tag") return FEATURE_PROPAGATION_WEIGHTS.tag;
  if (kind === "genre") return FEATURE_PROPAGATION_WEIGHTS.genre;
  if (kind === "creator") return FEATURE_PROPAGATION_WEIGHTS.creator;
  if (kind === "title-token") return FEATURE_PROPAGATION_WEIGHTS.titleToken;
  return FEATURE_PROPAGATION_WEIGHTS.format;
}

function isMoreDiverse(
  candidate: ScoredRecommendationCandidate,
  current: ScoredRecommendationCandidate,
  selected: ScoredRecommendationCandidate[],
  tagCounts: Map<string, number>,
  creatorCounts: Map<string, number>,
): boolean {
  const candidateTag = candidate.candidate.features.tags[0]?.name;
  const currentTag = current.candidate.features.tags[0]?.name;
  const candidateCreator = candidate.candidate.features.creators[0]?.name;
  const currentCreator = current.candidate.features.creators[0]?.name;
  const candidatePenalty =
    (tagCounts.get(candidateTag ?? "") ?? 0) * 0.03 +
    (creatorCounts.get(candidateCreator ?? "") ?? 0) * 0.04;
  const currentPenalty =
    (tagCounts.get(currentTag ?? "") ?? 0) * 0.03 +
    (creatorCounts.get(currentCreator ?? "") ?? 0) * 0.04;
  if (selected.length < 5 && candidatePenalty !== currentPenalty)
    return candidatePenalty < currentPenalty;
  return compareScored(candidate, current) < 0;
}

function compareScored(
  left: ScoredRecommendationCandidate,
  right: ScoredRecommendationCandidate,
): number {
  return right.score - left.score || left.anilistId - right.anilistId;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function roundScore(value: number): number {
  return Math.round(clamp(value / 100) * 10_000) / 100;
}

function positiveFeature(
  profile: RecommendationProfile,
  kind: RecommendationProfileFeatureKind,
  value: string,
): boolean {
  const feature = profile.features[profileFeatureKey(kind, value)];
  return Boolean(feature && feature.positiveWeight > feature.negativeWeight * 1.15);
}
