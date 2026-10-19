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
  /**
   * How many people rated the title at the provider behind `averageScore` (or `malScore` when
   * set): MyAnimeList scoring users, TMDB vote count. Absent when unknown.
   */
  ratingCount?: number;
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

export type RecommendationReasonCode =
  | "matches-tag"
  | "matches-genre"
  | "similar-to"
  | "same-creator"
  | "highly-rated"
  | "explore-more"
  | "anime-fit"
  | "manga-fit"
  /** "Try something new": outside the viewer's usual taste, well rated. */
  | "try-new"
  /** "Try something new": an older, little-known, well-rated title. */
  | "obscure-classic"
  | "documentary"
  /** Among Simkl's top-rated (the card links to the title on simkl.com). */
  | "on-simkl";

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
  /** "Try something new": the genres or tags this title brings that are new to the viewer. */
  newTastes?: string[];
  /** Tag-pair row: the kept taste and its new partner ("Romance", "Action"). */
  combo?: string[];
}

export interface RecommendationImpression extends RecommendationResult {
  requestId: string;
  position: number;
  shownAt: number;
}

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
  /**
   * Shrinkage strength k for the cross-section prior: while a section's own liked history is thin
   * the other sections count more, prior + (1 − prior)·k / (k + own mass). 0 keeps it fixed.
   * k = 20 from the offline harness (2026-10-12): Manga MRR 0.096 → 0.109 and HR@20 0.27 → 0.33
   * (15 hold-outs, so a small effect), Anime unchanged or slightly better; k = 40 hurt Manga.
   */
  crossTypeShrink: 20,
  halfLifeDays: 730,
} as const;
