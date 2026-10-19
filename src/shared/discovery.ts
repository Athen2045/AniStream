import type { MoreCatalogItem, MoreMediaType } from "./contracts";
import type { RecommendationReasonCode, RecommendationResult } from "./recommendations";

export interface DiscoveryFeed {
  status: "ready" | "learning" | "unavailable";
  items: RecommendationResult[];
  /** "Because you watched/read X" rows; items never repeat the main rail or another row. */
  rows?: DiscoveryRow[];
  requestId?: string;
  message?: string;
  /** Distinct titles of this type the viewer has watched/read (opening alone does not count). */
  sectionTitles?: number;
}
export interface DiscoveryFeedback {
  requestId: string;
  anilistId: number;
  action: "dismiss" | "undo" | "explore";
}
export interface DiscoveryImpressionInput {
  requestId: string;
  anilistIds: number[];
}
export interface DiscoveryRow {
  seedId: number;
  seedTitle: string;
  /** Set on a "Because you like <theme>" row; seedId/seedTitle then describe no single title. */
  theme?: string;
  /** The "next seasons of shows you watched" row (released sequels of liked titles). */
  continuation?: boolean;
  /** The "Try something new" row: well-rated titles outside the viewer's usual taste. */
  tryNew?: boolean;
  /** "Because you like A + B": the viewer's favourite pair of tastes; items swap one half. */
  pair?: string[];
  items: RecommendationResult[];
}

/** A More (TMDB) recommendation card. */
export interface MoreRecommendation {
  item: MoreCatalogItem;
  reasonCodes: RecommendationReasonCode[];
  /** Title of the watched/listed More title behind a "similar-to" reason. */
  relatedTitle?: string;
  /** The title's page on simkl.com when the pick came from Simkl (Simkl asks for a link back). */
  simklUrl?: string;
  /** "Try something new": the genres or tags this title brings that are new to the viewer. */
  newTastes?: string[];
  /** Tag-pair row: the kept taste and its new partner. */
  combo?: string[];
}

export interface MoreDiscoveryRow {
  seedTitle: string;
  seedType: MoreMediaType;
  seedId: number;
  /** Set on a "Because you like <theme>" row. */
  theme?: string;
  /** The "next in film series you watched" row. */
  continuation?: boolean;
  /** The "Try something new" row. */
  tryNew?: boolean;
  /** "Because you like A + B". */
  pair?: string[];
  items: MoreRecommendation[];
}

export interface MoreDiscoveryFeed {
  status: "ready" | "learning" | "unavailable";
  /**
   * "more": ranked from More history; "anime-taste": cold start from AniList taste while More
   * history is too thin.
   */
  basis?: "more" | "anime-taste";
  items: MoreRecommendation[];
  rows?: MoreDiscoveryRow[];
  requestId?: string;
  message?: string;
  /** Distinct movies and shows the viewer has watched (past the first quarter or finished). */
  sectionTitles?: number;
}

export interface MoreDiscoveryFeedback {
  requestId: string;
  type: MoreMediaType;
  tmdbId: number;
  action: "dismiss" | "undo";
}
