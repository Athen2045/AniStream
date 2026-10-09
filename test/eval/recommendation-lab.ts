// Offline recommendation lab: fixture types, user-affinity model, and candidate rankers.
// Rankers here are experiments; the winner is ported into src/main/recommendations.
import type { AniListDashboard, AniListMedia } from "../../src/shared/contracts";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";
import { discoveryEvidence } from "../../src/main/recommendations/discovery-evidence";
import { buildRecommendationProfile } from "../../src/main/recommendations/profile";
import {
  filterRecommendationCandidates,
  scoreRecommendationCandidate,
  selectRecommendations,
} from "../../src/main/recommendations/scoring";
import { rankHybrid } from "../../src/main/recommendations/hybrid";

export type MediaType = "ANIME" | "MANGA";

export interface FixtureMedia {
  id: number;
  type: MediaType;
  format?: string;
  status?: string;
  genres?: string[];
  averageScore?: number | null;
  popularity?: number | null;
  isAdult?: boolean;
  seasonYear?: number | null;
  title: { romaji?: string; english?: string | null; userPreferred?: string };
  tags?: Array<{
    id: number;
    name: string;
    rank: number;
    category: string;
    isMediaSpoiler: boolean;
  }>;
  studios?: { nodes: Array<{ id: number; name: string }> };
  staff?: { edges: Array<{ role: string; node: { id: number; name: { full: string } } }> };
  recommendations?: {
    nodes: Array<{ rating: number; mediaRecommendation: { id: number; type: MediaType } | null }>;
  };
  relations?: { edges: Array<{ relationType: string; node: { id: number; type: MediaType } }> };
}

export interface FixtureEntry {
  mediaId: number;
  status: "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";
  score: number;
  progress: number;
  repeat: number;
  updatedAt: number;
}

export interface Fixture {
  capturedAt: string;
  userName: string;
  lists: Record<MediaType, FixtureEntry[]>;
  media: Record<string, FixtureMedia>;
  browse: Array<{ type: MediaType; genre: string | null; sort: string; ids: number[] }>;
}

/** Everything a ranker may see: history with the held-out entry removed, and a candidate pool. */
export interface RankInput {
  fixture: Fixture;
  type: MediaType;
  history: FixtureEntry[]; // both media types; held-out removed
  pool: FixtureMedia[];
  now: number;
}

export type Ranker = (input: RankInput) => number[]; // candidate IDs, best first

// ---------------------------------------------------------------------------------------------
// User affinity: how much an entry says the user likes the title, in [-1, 1].

export function meanScore(entries: FixtureEntry[]): number {
  const scored = entries.filter((entry) => entry.score > 0);
  return scored.length ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length : 7;
}

export function affinity(entry: FixtureEntry, userMean: number): number | undefined {
  if (entry.status === "PLANNING") return undefined;
  let value: number;
  if (entry.score > 0) value = clamp((entry.score - (userMean - 1)) / 3, -1, 1);
  else if (entry.status === "DROPPED") value = -0.6;
  else if (entry.status === "PAUSED") value = 0;
  else if (entry.status === "COMPLETED" || entry.status === "REPEATING") value = 0.5;
  else value = entry.progress > 0 ? 0.35 : 0;
  if (entry.repeat > 0) value = Math.min(1, value + 0.3);
  if (entry.status === "DROPPED") value = Math.min(value, -0.3);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Baseline: the production pipeline (genre-only features, production evidence and scoring).

function toAniListMedia(media: FixtureMedia): AniListMedia {
  return {
    id: media.id,
    type: media.type,
    title: media.title.userPreferred ?? media.title.romaji ?? String(media.id),
    genres: media.genres ?? [],
    averageScore: media.averageScore ?? undefined,
    popularity: media.popularity ?? undefined,
    status: media.status,
  } as unknown as AniListMedia;
}

function productionDashboard(input: RankInput): AniListDashboard {
  const group = (type: MediaType) => [
    {
      entries: input.history
        .filter((entry) => input.fixture.media[entry.mediaId]?.type === type)
        .map((entry) => ({
          media: toAniListMedia(input.fixture.media[entry.mediaId]),
          status: entry.status,
          score: entry.score,
          progress: entry.progress,
          updatedAt: entry.updatedAt,
        })),
    },
  ];
  return {
    profile: { id: 1 },
    animeLists: group("ANIME"),
    mangaLists: group("MANGA"),
  } as unknown as AniListDashboard;
}

export function genreOnlyFeatures(media: FixtureMedia, now: number): RecommendationItemFeatures {
  return {
    anilistId: media.id,
    mediaType: media.type,
    normalizedTitle: media.title.userPreferred ?? String(media.id),
    genres: media.genres ?? [],
    titleTokens: [],
    synonyms: [],
    tags: [],
    creators: [],
    averageScore: media.averageScore ?? undefined,
    popularity: media.popularity ?? undefined,
    status: media.status,
    updatedAt: now,
  };
}

export function richFeatures(media: FixtureMedia, now: number): RecommendationItemFeatures {
  return {
    ...genreOnlyFeatures(media, now),
    tags: (media.tags ?? [])
      .filter((tag) => tag.rank >= 40 && !tag.isMediaSpoiler)
      .map((tag) => ({ id: tag.id, name: tag.name, rank: tag.rank })),
    creators: [
      ...(media.studios?.nodes ?? []).map((studio) => ({
        id: studio.id,
        name: studio.name,
        role: "STUDIO" as const,
      })),
      ...creatorStaff(media).map((staff) => ({
        id: staff.node.id,
        name: staff.node.name.full,
        role: "STAFF" as const,
      })),
    ],
  };
}

function productionRanker(features: typeof genreOnlyFeatures, sortAll: boolean): Ranker {
  return (input) => {
    const evidence = discoveryEvidence([], productionDashboard(input));
    const itemFeatures = evidence.media.map((media) =>
      features(input.fixture.media[media.id], input.now),
    );
    const profile = buildRecommendationProfile(evidence.events, itemFeatures, input.now);
    const scored = filterRecommendationCandidates(
      input.pool.map((media) => ({ features: features(media, input.now) })),
      new Set(),
    ).map((candidate) => scoreRecommendationCandidate(candidate, profile, input.now));
    if (sortAll)
      return scored
        .sort((a, b) => b.rawScore - a.rawScore || a.anilistId - b.anilistId)
        .map((row) => row.anilistId);
    const top = selectRecommendations(scored, 10).map((row) => row.anilistId);
    const topSet = new Set(top);
    return [
      ...top,
      ...scored
        .filter((row) => !topSet.has(row.anilistId))
        .sort((a, b) => b.rawScore - a.rawScore)
        .map((row) => row.anilistId),
    ];
  };
}

export const currentRanker = productionRanker(genreOnlyFeatures, false);
export const currentRichRanker = productionRanker(richFeatures, false);

export const popularityRanker: Ranker = (input) =>
  [...input.pool]
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id)
    .map((media) => media.id);

/** The production candidate pool: Trending + SCORE_DESC pages of the top two profile genres. */
export function productionPool(
  input: Omit<RankInput, "pool">,
  excluded: Set<number>,
  genreCount = 2,
): FixtureMedia[] {
  const evidence = discoveryEvidence([], productionDashboard({ ...input, pool: [] }));
  const itemFeatures = evidence.media.map((media) =>
    genreOnlyFeatures(input.fixture.media[media.id], input.now),
  );
  const profile = buildRecommendationProfile(evidence.events, itemFeatures, input.now);
  const genres = Object.entries(profile.features)
    .filter(([key]) => key.startsWith("genre:"))
    .map(([key, value]) => ({ key, weight: value.positiveWeight - value.negativeWeight * 1.15 }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, genreCount)
    .map((row) => row.key.slice("genre:".length));
  const ids = input.fixture.browse
    .filter(
      (page) =>
        page.type === input.type &&
        (page.genre === null ||
          genres.includes(page.genre.toLocaleLowerCase().replace(/\s+/g, "-"))),
    )
    .flatMap((page) => page.ids);
  return [...new Set(ids)]
    .filter((id) => !excluded.has(id))
    .map((id) => input.fixture.media[id])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// New ranker: IDF-weighted content similarity + AniList recommendation graph + quality prior.

export interface HybridWeights {
  graph: number;
  content: number;
  quality: number;
  popularity: number;
  crossTypePrior: number; // weight of the other media type's history (shared taste)
  halfLifeDays: number;
}

export const DEFAULT_HYBRID: HybridWeights = {
  graph: 0.55,
  content: 0.35,
  quality: 0.1,
  popularity: 0,
  crossTypePrior: 0.35,
  halfLifeDays: 365,
};

function creatorStaff(media: FixtureMedia) {
  return (media.staff?.edges ?? []).filter((edge) =>
    /original creator|story|art|director|series composition/i.test(edge.role),
  );
}

type Vector = Map<string, number>;

function rawVector(media: FixtureMedia): Vector {
  const vector: Vector = new Map();
  for (const genre of media.genres ?? []) vector.set(`g:${genre}`, 1);
  for (const tag of media.tags ?? []) {
    if (tag.rank < 40) continue;
    vector.set(`t:${tag.name}`, (tag.rank / 100) * (tag.isMediaSpoiler ? 0.5 : 1));
  }
  for (const studio of media.studios?.nodes ?? []) vector.set(`s:${studio.id}`, 0.8);
  for (const staff of creatorStaff(media)) vector.set(`p:${staff.node.id}`, 0.8);
  return vector;
}

class ContentSpace {
  private readonly idf = new Map<string, number>();
  private readonly cache = new Map<number, Vector>();
  constructor(corpus: FixtureMedia[]) {
    const df = new Map<string, number>();
    for (const media of corpus)
      for (const key of rawVector(media).keys()) df.set(key, (df.get(key) ?? 0) + 1);
    for (const [key, count] of df)
      this.idf.set(key, Math.log((1 + corpus.length) / (1 + count)) + 1);
  }
  vector(media: FixtureMedia): Vector {
    const cached = this.cache.get(media.id);
    if (cached) return cached;
    const vector: Vector = new Map();
    let norm = 0;
    for (const [key, value] of rawVector(media)) {
      const weighted = value * (this.idf.get(key) ?? 1);
      vector.set(key, weighted);
      norm += weighted * weighted;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [key, value] of vector) vector.set(key, value / norm);
    this.cache.set(media.id, vector);
    return vector;
  }
}

function addScaled(target: Vector, source: Vector, scale: number): void {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value * scale);
}

function cosine(profile: Vector, profileNorm: number, item: Vector): number {
  let dot = 0;
  for (const [key, value] of item) dot += value * (profile.get(key) ?? 0);
  return profileNorm > 0 ? dot / profileNorm : 0;
}

export function hybridRanker(weights: HybridWeights = DEFAULT_HYBRID): Ranker {
  return (input) => {
    const { fixture, type, now } = input;
    const userMean = meanScore(input.history);
    const corpus = [
      ...input.history.map((entry) => fixture.media[entry.mediaId]),
      ...input.pool,
    ].filter(Boolean);
    const space = new ContentSpace(corpus);
    const profile: Vector = new Map();
    const graph = new Map<number, number>();
    const halfLife = weights.halfLifeDays * 86_400;

    for (const entry of input.history) {
      const media = fixture.media[entry.mediaId];
      const value = affinity(entry, userMean);
      if (!media || value === undefined || value === 0) continue;
      const decay = Math.pow(0.5, Math.max(0, now / 1000 - entry.updatedAt) / halfLife);
      const typeWeight = media.type === type ? 1 : weights.crossTypePrior;
      const weight = value * decay * typeWeight;
      addScaled(profile, space.vector(media), weight);
      const nodes = (media.recommendations?.nodes ?? []).filter(
        (node) => node.mediaRecommendation && node.rating > 0,
      );
      const maxRating = Math.max(1, ...nodes.map((node) => node.rating));
      for (const node of nodes) {
        const id = node.mediaRecommendation!.id;
        const edge = Math.log1p(node.rating) / Math.log1p(maxRating);
        graph.set(id, (graph.get(id) ?? 0) + weight * edge);
      }
    }

    let profileNorm = 0;
    for (const value of profile.values()) profileNorm += value * value;
    profileNorm = Math.sqrt(profileNorm);
    const maxGraph = Math.max(1e-9, ...[...graph.values()].filter((value) => value > 0));

    return input.pool
      .map((media) => {
        const content = Math.max(0, cosine(profile, profileNorm, space.vector(media)));
        const graphScore = Math.max(0, graph.get(media.id) ?? 0) / maxGraph;
        const quality = clamp(((media.averageScore ?? 60) - 50) / 40, 0, 1);
        const popularity = clamp(Math.log10(Math.max(1, media.popularity ?? 1)) / 6);
        return {
          id: media.id,
          score:
            weights.graph * graphScore +
            weights.content * content +
            weights.quality * quality +
            weights.popularity * popularity,
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .map((row) => row.id);
  };
}

/** Retrieval for the new design: recommendation-graph neighbors of positive seeds + browse pools. */
export function hybridPool(
  input: Omit<RankInput, "pool">,
  excluded: Set<number>,
  genreCount = 2,
): FixtureMedia[] {
  const userMean = meanScore(input.history);
  const ids = new Set<number>();
  for (const entry of input.history) {
    const media = input.fixture.media[entry.mediaId];
    if (!media || (affinity(entry, userMean) ?? 0) <= 0) continue;
    for (const node of media.recommendations?.nodes ?? [])
      if (node.mediaRecommendation?.type === input.type) ids.add(node.mediaRecommendation.id);
  }
  for (const media of productionPool(input, excluded, genreCount)) ids.add(media.id);
  return [...ids]
    .filter((id) => !excluded.has(id))
    .map((id) => input.fixture.media[id])
    .filter(
      (media): media is FixtureMedia =>
        Boolean(media) && media.type === input.type && !media.isAdult,
    );
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

// ---------------------------------------------------------------------------------------------
// The shipped ranker (src/main/recommendations/hybrid.ts) fed with production-shaped features.

export function productionFeatures(media: FixtureMedia, now: number): RecommendationItemFeatures {
  return {
    ...genreOnlyFeatures(media, now),
    tags: (media.tags ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      rank: tag.isMediaSpoiler ? tag.rank / 2 : tag.rank,
    })),
    creators: [
      ...(media.studios?.nodes ?? []).map((studio) => ({
        id: studio.id,
        name: studio.name,
        role: "STUDIO" as const,
      })),
      ...creatorStaff(media).map((staff) => ({
        id: staff.node.id,
        name: staff.node.name.full,
        role: "STAFF" as const,
      })),
    ],
    isAdult: media.isAdult,
    recommendations: media.recommendations?.nodes
      .flatMap((node) =>
        node.mediaRecommendation && node.rating > 0
          ? [
              {
                id: node.mediaRecommendation.id,
                mediaType: node.mediaRecommendation.type,
                rating: node.rating,
              },
            ]
          : [],
      )
      .slice(0, 10),
  };
}

export const shippedRanker: Ranker = (input) => {
  const userMean = meanScore(input.history);
  const history = input.history.flatMap((entry) => {
    const media = input.fixture.media[entry.mediaId];
    const value = affinity(entry, userMean);
    return media && value !== undefined && value !== 0
      ? [
          {
            features: productionFeatures(media, input.now),
            affinity: value,
            occurredAt: entry.updatedAt * 1000,
          },
        ]
      : [];
  });
  return rankHybrid({
    section: input.type,
    history,
    candidates: input.pool.map((media) => productionFeatures(media, input.now)),
    now: input.now,
  }).map((row) => row.features.anilistId);
};
