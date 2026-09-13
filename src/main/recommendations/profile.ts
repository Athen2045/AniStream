import {
  EVENT_WEIGHTS,
  FEATURE_PROPAGATION_WEIGHTS,
  type RecommendationEvent,
  type RecommendationEventType,
  type RecommendationItemFeatures,
  type RecommendationProfile,
  type RecommendationProfileFeatureKind,
} from "../../shared/recommendations";

const DAY_MS = 86_400_000;

export function buildRecommendationProfile(
  events: RecommendationEvent[],
  items: RecommendationItemFeatures[],
  now: number,
): RecommendationProfile {
  const itemsById = new Map(items.map((item) => [item.anilistId, item]));
  const features = new Map<
    string,
    {
      positiveWeight: number;
      negativeWeight: number;
      evidenceCount: number;
      lastSeenAt: number;
    }
  >();
  const mediaCounts = { anime: 0, manga: 0 };
  const seenExplorations = new Set<string>();

  for (const event of [...events].sort((left, right) => left.occurredAt - right.occurredAt)) {
    const item = itemsById.get(event.anilistId);
    if (!item) continue;
    if (event.eventType === "explored") {
      const dayKey = `${event.anilistId}:${Math.floor(event.occurredAt / DAY_MS)}`;
      if (seenExplorations.has(dayKey)) continue;
      seenExplorations.add(dayKey);
    }

    const baseWeight = eventWeight(event.eventType, event.value);
    if (baseWeight === 0) continue;
    const ageDays = Math.max(0, (now - event.occurredAt) / DAY_MS);
    const decayedWeight = baseWeight * Math.exp(-ageDays / 120);
    const positive = Math.max(0, decayedWeight);
    const negative = Math.max(0, -decayedWeight);
    for (const [kind, values] of itemFeatures(item)) {
      for (const value of values) {
        addFeature(features, profileFeatureKey(kind, value), positive, negative, event.occurredAt);
      }
    }
    if (positive > 0) mediaCounts[item.mediaType === "ANIME" ? "anime" : "manga"] += positive;
  }

  const totalMediaEvidence = mediaCounts.anime + mediaCounts.manga;
  return {
    version: 1,
    updatedAt: now,
    features: Object.fromEntries(features),
    preferredMediaMix:
      totalMediaEvidence > 0
        ? {
            anime: mediaCounts.anime / totalMediaEvidence,
            manga: mediaCounts.manga / totalMediaEvidence,
          }
        : { anime: 0.5, manga: 0.5 },
  };
}

export function profileFeatureKey(kind: RecommendationProfileFeatureKind, value: string): string {
  return `${kind}:${normalize(value)}`;
}

function eventWeight(type: RecommendationEventType, value?: number): number {
  if (type === "rated") {
    if (value === undefined) return 0;
    if (value >= 8) return EVENT_WEIGHTS.ratedHigh;
    if (value >= 5) return EVENT_WEIGHTS.ratedMedium;
    return EVENT_WEIGHTS.ratedLow;
  }
  return EVENT_WEIGHTS[type === "searched-and-opened" ? "searchedAndOpened" : type] ?? 0;
}

function itemFeatures(
  item: RecommendationItemFeatures,
): Array<[RecommendationProfileFeatureKind, string[]]> {
  return [
    ["tag", item.tags.map((tag) => tag.name)],
    ["genre", item.genres],
    ["creator", item.creators.map((creator) => creator.name)],
    [
      "title-token",
      [...item.titleTokens, ...item.synonyms.flatMap((synonym) => tokenize(synonym))],
    ],
    ["format", [item.mediaType === "ANIME" ? "anime" : "manga"]],
  ];
}

function addFeature(
  features: Map<string, RecommendationProfile["features"][string]>,
  key: string,
  positiveWeight: number,
  negativeWeight: number,
  lastSeenAt: number,
): void {
  const current = features.get(key) ?? {
    positiveWeight: 0,
    negativeWeight: 0,
    evidenceCount: 0,
    lastSeenAt,
  };
  const kind = key.slice(0, key.indexOf(":"));
  const propagation =
    kind === "title-token"
      ? FEATURE_PROPAGATION_WEIGHTS.titleToken
      : kind === "creator"
        ? FEATURE_PROPAGATION_WEIGHTS.creator
        : kind === "format"
          ? FEATURE_PROPAGATION_WEIGHTS.format
          : FEATURE_PROPAGATION_WEIGHTS[kind as "tag" | "genre"];
  current.positiveWeight += positiveWeight * propagation;
  current.negativeWeight += negativeWeight * propagation;
  current.evidenceCount += 1;
  current.lastSeenAt = Math.max(current.lastSeenAt, lastSeenAt);
  features.set(key, current);
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}
