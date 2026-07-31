export type AnimeProviderKind = "embed";

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
  language?: string;
}

export interface AnimeSourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly kind: AnimeProviderKind;
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
