import type { RecommendationItemType, RecommendationSection } from "./recommendations";

/**
 * The viewer's taste as a graph (Settings > Your taste map): liked titles linked by similarity,
 * series and recommendations, grouped into named taste clusters. Built on the device from local
 * history only.
 */
export interface TasteMap {
  nodes: TasteMapNode[];
  links: TasteMapLink[];
  clusters: TasteMapCluster[];
  /** Liked titles the map was built from (shown or folded into a cluster). */
  titles: number;
  builtAt: number;
}

export type TasteTrend = "growing" | "steady" | "fading";

export interface TasteMapNode {
  /** Item key (`ANIME:1`, `MOVIE:603`) for titles, `cluster:<id>` for cluster hubs. */
  id: string;
  kind: "title" | "cluster";
  label: string;
  section: RecommendationSection;
  /** Title type, for opening its page. */
  mediaType?: RecommendationItemType;
  /** Provider ID of a title. */
  mediaId?: number;
  /** Relative strength in (0, 1]: affinity × recency for titles, cluster weight for hubs. */
  weight: number;
  cluster: number;
  coverUrl?: string;
  /** Hubs: titles of the cluster folded into it to keep the map readable. */
  folded?: number;
}

export interface TasteMapLink {
  source: string;
  target: string;
  /** Strength in (0, 1]. */
  weight: number;
  kind: "similar" | "series" | "recommended" | "cluster" | "bridge";
}

export interface TasteMapCluster {
  id: number;
  label: string;
  section: RecommendationSection;
  weight: number;
  titles: number;
  trend: TasteTrend;
}

export const EMPTY_TASTE_MAP: TasteMap = {
  nodes: [],
  links: [],
  clusters: [],
  titles: 0,
  builtAt: 0,
};
