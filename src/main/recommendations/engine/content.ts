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

/**
 * Content-warning tags (AniList, TMDB keywords): they still shape similarity, but never name a
 * taste on screen ("Your taste map" labels, "New to you" captions). Lower case.
 */
export const SENSITIVE_TAGS = new Set([
  "rape",
  "sexual abuse",
  "incest",
  "nudity",
  "masturbation",
  "suicide",
  "self-harm",
  "torture",
  "cannibalism",
  "child abuse",
  "domestic abuse",
  "pedophilia",
  "slavery",
  "drugs",
  "prostitution",
  "sex work",
]);

/**
 * A random source seeded by a key and the day: rows that rotate (which liked titles seed "Because
 * you watched", which theme leads) change once a day and stay put within it, instead of
 * reshuffling on every load (user request 2026-10-19). mulberry32 over an FNV-1a hash.
 */
export function dailyRandom(key: string, now: number): () => number {
  let hash = 0x811c9dc5;
  const text = `${key}:${Math.floor(now / DAY_MS)}`;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

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

/**
 * The same vectors as sorted typed arrays over one interned feature vocabulary, for all-pairs
 * work: a merge-join dot product is about twice as fast as Map lookups (measured on 600 titles).
 */
export interface PackedVector {
  features: Int32Array;
  values: Float64Array;
}

export function packVectors(vectors: Vector[]): PackedVector[] {
  const ids = new Map<string, number>();
  return vectors.map((vector) => {
    const entries = [...vector]
      .map(([feature, value]): [number, number] => {
        let id = ids.get(feature);
        if (id === undefined) ids.set(feature, (id = ids.size));
        return [id, value];
      })
      .sort((a, b) => a[0] - b[0]);
    return {
      features: Int32Array.from(entries, (entry) => entry[0]),
      values: Float64Array.from(entries, (entry) => entry[1]),
    };
  });
}

export function packedDot(left: PackedVector, right: PackedVector): number {
  const { features: a, values: av } = left;
  const { features: b, values: bv } = right;
  let i = 0;
  let j = 0;
  let sum = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) sum += av[i++] * bv[j++];
    else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return sum;
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
