export type AnimeProviderKind = "hls" | "torrent";

export interface AnimeTitleMapping {
  providerId: string;
  aniListId: number;
  providerTitle: string;
  canonicalTitle: string;
  aliases: string[];
  seasons: AnimeSeason[];
}

export interface AnimeSeason {
  providerSeasonId: string;
  number?: number;
  title: string;
  episodes: AnimeEpisode[];
}

export interface AnimeEpisode {
  providerEpisodeId: string;
  number: number;
  title?: string;
  thumbnailUrl?: string;
  airDate?: string;
  hosters: AnimeHoster[];
}

export interface AnimeHoster {
  providerHosterId: string;
  name: string;
  kind: AnimeProviderKind;
  variants: AnimeVideoVariant[];
}

export interface AnimeVideoVariant {
  id: string;
  url: string;
  kind: AnimeProviderKind;
  quality?: string;
  language?: string;
  subtitles?: string[];
  headers?: Record<string, string>;
  seeders?: number;
  sizeBytes?: number;
}

export interface AnimeSourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly kind: AnimeProviderKind;
  searchTitles(query: string): Promise<AnimeTitleMapping[]>;
  resolveTitle(aniListId: number, titles: string[]): Promise<AnimeTitleMapping | undefined>;
  getEpisodes(providerSeasonId: string): Promise<AnimeEpisode[]>;
  getVideoVariants(providerEpisodeId: string): Promise<AnimeVideoVariant[]>;
}

export interface AnimePlaybackResolution {
  aniListId: number;
  episode: number;
  primary?: AnimeVideoVariant;
  fallbacks: AnimeVideoVariant[];
  attemptedProviderIds: string[];
}
