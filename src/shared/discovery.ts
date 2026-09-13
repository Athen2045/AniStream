import type { AniListMediaType } from "./contracts";
import type { RecommendationResult } from "./recommendations";

export interface DiscoveryFeed {
  status: "ready" | "learning" | "unavailable";
  items: RecommendationResult[];
  requestId?: string;
  message?: string;
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
export interface DiscoveryRequest {
  type: AniListMediaType;
}
