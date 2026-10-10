import type { AniListMediaType, MoreMediaType } from "./contracts";

export type RecommendationMediaType = AniListMediaType;
/** Every rankable item kind: AniList anime/manga and TMDB movies/shows (the More section). */
export type RecommendationItemType = RecommendationMediaType | MoreMediaType;
/** A For You surface; MOVIE and TV items both belong to the More section. */
export type RecommendationSection = RecommendationMediaType | "MORE";

export function recommendationSection(type: RecommendationItemType): RecommendationSection {
  return type === "MOVIE" || type === "TV" ? "MORE" : type;
}

export type RecommendationEventType =
  | "explored"
  | "searched-and-opened"
  | "started"
  | "progressed"
  | "completed"
  | "rated"
  | "skipped"
  | "dismissed"
  | "saved";

export type RecommendationEventSource = "detail" | "search" | "player" | "reader" | "profile";

export interface RecommendationEvent {
  mediaType: RecommendationMediaType;
  anilistId: number;
  occurredAt: number;
  eventType: RecommendationEventType;
  source: RecommendationEventSource;
  value?: number;
}

/** AniList studios/staff, or TMDB people (directors, creators, lead cast) and companies. */
export type RecommendationCreatorRole =
  "AUTHOR" | "ARTIST" | "STUDIO" | "STAFF" | "PERSON" | "COMPANY";

export interface RecommendationTag {
  id: number;
  name: string;
  rank?: number;
}

export interface RecommendationCreator {
  id?: number;
  name: string;
  role: RecommendationCreatorRole;
}

export interface RecommendationItemFeatures {
  /**
   * Provider ID within `mediaType`: AniList for ANIME/MANGA, TMDB for MOVIE/TV. Historical name;
   * always key items by mediaType and ID together.
   */
  anilistId: number;
  mediaType: RecommendationItemType;
  malId?: number;
  normalizedTitle: string;
  coverUrl?: string;
  /** Display-only artwork/date for More cards rebuilt from cached features. */
  backdropUrl?: string;
  releaseDate?: string;
  titleTokens: string[];
  synonyms: string[];
  genres: string[];
  tags: RecommendationTag[];
  creators: RecommendationCreator[];
  averageScore?: number;
  malScore?: number;
  popularity?: number;
  status?: string;
  /**
   * TMDB collection (a film series) for movies; groups a franchise like AniList relations.
   * 0 means the film belongs to none.
   */
  collectionId?: number;
  /** AniList start date as YYYYMMDD (unknown month/day are 00); orders seasons by release. */
  startedOn?: number;
  format?: string;
  isAdult?: boolean;
  /**
   * Where the title comes from: TMDB's original language ("ml", "en") for movies and shows,
   * AniList's country of origin ("JP", "KR") for anime and manga. Rows follow their seed's origin.
   */
  origin?: string;
  /** Provider "More like this" edges (exact IDs, user-voted rating); present on hydrated seeds. */
  recommendations?: RecommendationEdge[];
  /** Exact provider franchise/adaptation links; absent on rows cached before they were fetched. */
  relations?: RecommendationRelation[];
  updatedAt: number;
}

export interface RecommendationRelation {
  id: number;
  mediaType: RecommendationItemType;
  relationType:
    | "PREQUEL"
    | "SEQUEL"
    | "PARENT"
    | "SIDE_STORY"
    | "ADAPTATION"
    | "SOURCE"
    | "ALTERNATIVE"
    | "SPIN_OFF";
}

export interface RecommendationEdge {
  id: number;
  mediaType: RecommendationItemType;
  rating: number;
}

export type RecommendationProfileFeatureKind =
  "tag" | "genre" | "creator" | "title-token" | "format";

export interface RecommendationProfileFeature {
  positiveWeight: number;
  negativeWeight: number;
  evidenceCount: number;
  lastSeenAt: number;
}

export interface RecommendationProfile {
  version: 1;
  updatedAt: number;
  features: Record<string, RecommendationProfileFeature>;
  preferredMediaMix: {
    anime: number;
    manga: number;
  };
}

export interface RecommendationCandidate {
  features: RecommendationItemFeatures;
  relationStrength?: number;
  relatedTo?: number;
  completed?: boolean;
  current?: boolean;
  dismissed?: boolean;
}

export type RecommendationReasonCode =
  | "matches-tag"
  | "matches-genre"
  | "similar-to"
  | "same-creator"
  | "highly-rated"
  | "explore-more"
  | "anime-fit"
  | "manga-fit";

export interface RecommendationResult {
  anilistId: number;
  mediaType: RecommendationMediaType;
  malId?: number;
  title: string;
  coverUrl?: string;
  score: number;
  reasonCodes: RecommendationReasonCode[];
  relatedTo?: number;
  /** Display title of the history entry behind a "similar-to" reason. */
  relatedTitle?: string;
}

export interface RecommendationImpression extends RecommendationResult {
  requestId: string;
  position: number;
  shownAt: number;
}

export interface ScoredRecommendationCandidate extends RecommendationResult {
  candidate: RecommendationCandidate;
  rawScore: number;
}

export const EVENT_WEIGHTS = {
  explored: 0.25,
  searchedAndOpened: 0.45,
  started: 0.75,
  progressed: 0.9,
  completed: 1.25,
  ratedHigh: 1.5,
  ratedMedium: 0.15,
  ratedLow: -1.25,
  skipped: -0.6,
  dismissed: -1.5,
  saved: 1,
} as const;

export const FEATURE_PROPAGATION_WEIGHTS = {
  tag: 1,
  genre: 0.7,
  creator: 0.85,
  titleToken: 0.35,
  format: 0.25,
} as const;

export const RANKING_WEIGHTS = {
  preferenceMatch: 0.42,
  relationMatch: 0.18,
  creatorMatch: 0.12,
  qualitySignal: 0.1,
  mediaTypeFit: 0.08,
  freshness: 0.05,
  explorationBonus: 0.05,
} as const;

/**
 * Hybrid For You weights. Chosen with the offline leave-one-out harness (test/eval, 2026-10-04):
 * graph = provider recommendation edges from liked history, content = IDF-weighted cosine over
 * genres/tags/creators, popularity and quality are priors. Heuristic ranks, not probabilities.
 */
export const HYBRID_WEIGHTS = {
  graph: 0.3,
  content: 0.35,
  popularity: 0.3,
  quality: 0.1,
  /** Weight of the other media type's history (shared taste, own section first). */
  crossTypePrior: 0.35,
  halfLifeDays: 730,
} as const;
