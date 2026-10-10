/** Shared shapes of the recommendation engine: history in, scored candidates and picks out. */
import type {
  HYBRID_WEIGHTS,
  RecommendationItemFeatures,
  RecommendationItemType,
  RecommendationReasonCode,
  RecommendationSection,
} from "../../../shared/recommendations";

export interface HybridHistoryItem {
  features: RecommendationItemFeatures;
  /** Viewer affinity in [-1, 1]; dismissals are -1. */
  affinity: number;
  occurredAt: number;
}

export interface HybridRankInput {
  section: RecommendationSection;
  history: HybridHistoryItem[];
  candidates: RecommendationItemFeatures[];
  now: number;
  weights?: Partial<Record<keyof typeof HYBRID_WEIGHTS, number>>;
}

export interface HybridScored {
  features: RecommendationItemFeatures;
  rawScore: number;
  graph: number;
  content: number;
  /** Item key of the liked history title contributing the most graph weight. */
  seedKey?: string;
}

/** A selected candidate, independent of which provider's result shape the caller needs. */
export interface HybridPick {
  features: RecommendationItemFeatures;
  /** Heuristic rank score on a 0–100 scale; not a probability. */
  score: number;
  reasonCodes: RecommendationReasonCode[];
  seed?: RecommendationItemFeatures;
}

export interface HybridSeedRow {
  seed: RecommendationItemFeatures;
  items: HybridPick[];
}

export interface SeedRowOptions {
  maxRows?: number;
  perRow?: number;
  minItems?: number;
  /** Source of the seed order; a value near 1 keeps the newest-first order (tests). */
  random?: () => number;
  /**
   * Slots per row for the closest titles of the other media type (More: shows in a movie's row
   * and movies in a show's), spread through the row. Provider edges never cross types.
   */
  crossType?: number;
}

export interface PickOptions {
  /** Each media type gets at least this many picks when one ranks in the top `balanceWithin`. */
  minPerType?: number;
  balanceWithin?: number;
  /**
   * Calibration strength in [0, 1] (Netflix, Steck 2018): how much the rail should follow the
   * viewer's genre mix instead of filling up with their single strongest taste. 0 turns it off.
   */
  calibrate?: number;
}

/** Score changes applied after ranking (`adjustScores`). */
export interface ScoreAdjustments {
  now: number;
  /** Days each title (item key) was shown without being opened since. */
  ignored?: ReadonlyMap<string, number>;
  /** Released next entries of liked titles (item keys), the "in-network" source. */
  continuation?: ReadonlySet<string>;
}

/** A "Because you like <theme>" row. */
export interface HybridThemeRow {
  theme: string;
  items: HybridPick[];
}

/** A theme the viewer keeps returning to, in rotation order. */
export interface HybridTheme {
  key: string;
  name: string;
  /** Provider tag/keyword ID, for fetching more titles that carry it. */
  id?: number;
  /** The item type most of the liked titles with this theme have. */
  mediaType: RecommendationItemType;
}
