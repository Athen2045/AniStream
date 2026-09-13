import type { AniListMediaType } from "./contracts";

export type RecommendationMediaType = AniListMediaType;

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

export type RecommendationCreatorRole = "AUTHOR" | "ARTIST" | "STUDIO" | "STAFF";

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
  anilistId: number;
  mediaType: RecommendationMediaType;
  malId?: number;
  normalizedTitle: string;
  coverUrl?: string;
  titleTokens: string[];
  synonyms: string[];
  genres: string[];
  tags: RecommendationTag[];
  creators: RecommendationCreator[];
  averageScore?: number;
  malScore?: number;
  popularity?: number;
  status?: string;
  updatedAt: number;
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
