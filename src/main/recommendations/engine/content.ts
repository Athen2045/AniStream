/**
 * The content space every stage shares: item keys, IDF-weighted feature vectors (genres, tags,
 * creators, origin), and the popularity/quality priors.
 */
import type {
  RecommendationItemFeatures,
  RecommendationItemType,
} from "../../../shared/recommendations";

export const DAY_MS = 86_400_000;

export const MIN_TAG_RANK = 40;

export type Vector = Map<string, number>;

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
}

/** Items from different providers can share numeric IDs; always key by type and ID. */
export function itemKey(item: { mediaType: RecommendationItemType; anilistId: number }): string {
  return `${item.mediaType}:${item.anilistId}`;
}

export function edgeKey(edge: { mediaType: RecommendationItemType; id: number }): string {
  return `${edge.mediaType}:${edge.id}`;
}

/** TMDB's "xx" means no language; it is not a shared origin. */
export function knownOrigin(item: RecommendationItemFeatures): string | undefined {
  return item.origin && item.origin !== "xx" ? item.origin : undefined;
}

export function creatorKey(creator: RecommendationItemFeatures["creators"][number]): string {
  return creator.id === undefined
    ? `${creator.role}:${creator.name}`
    : `${creator.role}:${creator.id}`;
}

/** AniList tags and TMDB keywords share a case-insensitive vocabulary ("Time Travel"). */
export function tagKey(name: string): string {
  return name.toLocaleLowerCase();
}

function rawVector(item: RecommendationItemFeatures): Vector {
  const vector: Vector = new Map();
  for (const genre of item.genres) vector.set(`g:${genre}`, 1);
  for (const tag of item.tags)
    if ((tag.rank ?? 0) >= MIN_TAG_RANK) vector.set(`t:${tagKey(tag.name)}`, (tag.rank ?? 0) / 100);
  for (const creator of item.creators) vector.set(`c:${creatorKey(creator)}`, 0.8);
  // Origin (language or country) is one feature among many; IDF keeps a shared origin such as
  // English nearly silent while a rarer one such as Malayalam pulls strongly.
  const origin = knownOrigin(item);
  if (origin) vector.set(`o:${origin}`, 1);
  return vector;
}

export function qualityPrior(item: RecommendationItemFeatures): number {
  return clamp(((item.averageScore ?? 60) - 50) / 40);
}

export function popularityPrior(item: RecommendationItemFeatures): number {
  return clamp(Math.log10(Math.max(1, item.popularity ?? 1)) / 6);
}

export function compareItems(
  left: RecommendationItemFeatures,
  right: RecommendationItemFeatures,
): number {
  return left.anilistId - right.anilistId || left.mediaType.localeCompare(right.mediaType);
}

export class ContentSpace {
  private readonly idf = new Map<string, number>();
  private readonly cache = new Map<string, Vector>();
  constructor(corpus: RecommendationItemFeatures[]) {
    const df = new Map<string, number>();
    const seen = new Set<string>();
    for (const item of corpus) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const feature of rawVector(item).keys()) df.set(feature, (df.get(feature) ?? 0) + 1);
    }
    for (const [feature, count] of df)
      this.idf.set(feature, Math.log((1 + seen.size) / (1 + count)) + 1);
  }
  /** How rare a feature is in this corpus; unseen features count as rarest-but-one. */
  rarity(feature: string): number {
    return this.idf.get(feature) ?? 1;
  }
  vector(item: RecommendationItemFeatures): Vector {
    const key = itemKey(item);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const vector: Vector = new Map();
    let norm = 0;
    for (const [feature, value] of rawVector(item)) {
      const weighted = value * (this.idf.get(feature) ?? 1);
      vector.set(feature, weighted);
      norm += weighted * weighted;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [feature, value] of vector) vector.set(feature, value / norm);
    this.cache.set(key, vector);
    return vector;
  }
}

/** Sparse dot product; the cosine when both vectors are unit length. */
export function dot(left: Vector, right: Vector): number {
  let sum = 0;
  for (const [key, value] of right) sum += value * (left.get(key) ?? 0);
  return sum;
}

export function addScaled(target: Vector, source: Vector, scale: number): void {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value * scale);
}

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
