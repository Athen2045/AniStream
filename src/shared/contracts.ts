export interface AppInfo {
  version: string;
  platform: string;
  databaseReady: boolean;
  videoSourceStatus: "configured" | "unavailable";
}

export type AniListMediaType = "ANIME" | "MANGA";

export type AniListEntryStatus =
  "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";

export interface AniListProfile {
  id: number;
  name: string;
  about?: string;
  avatarUrl: string;
  bannerUrl?: string;
  siteUrl: string;
  animeCount: number;
  episodesWatched: number;
  minutesWatched: number;
  mangaCount: number;
  chaptersRead: number;
  volumesRead: number;
}

export interface AniListMedia {
  id: number;
  type: AniListMediaType;
  title: string;
  coverUrl: string;
  format?: string;
  status?: string;
  totalProgress?: number;
  totalVolumes?: number;
  genres?: string[];
  averageScore?: number;
  nextAiringEpisode?: {
    episode: number;
    airingAt: number;
  };
  siteUrl: string;
}

export interface AniListCatalogMedia extends AniListMedia {
  /** MAL cross-reference from AniList's own idMal field; enables MAL score lookups. */
  malId?: number;
  bannerUrl?: string;
  description?: string;
  genres: string[];
  averageScore?: number;
  popularity?: number;
  season?: string;
  seasonYear?: number;
}

export interface AniListPageInfo {
  currentPage: number;
  perPage: number;
  lastPage: number;
  hasNextPage: boolean;
}

export interface AniListCatalogPage {
  pageInfo: AniListPageInfo;
  items: AniListCatalogMedia[];
}

export interface BrowseAniListInput {
  type: AniListMediaType;
  page: number;
  perPage?: number;
  query?: string;
  genre?: string;
  sort?: "TRENDING_DESC" | "POPULARITY_DESC" | "SCORE_DESC" | "START_DATE_DESC";
}

export interface AnimeEpisodeCatalogInput {
  aniListId: number;
  titles: string[];
  seasonLabel?: string;
  totalEpisodes?: number;
  fallbackThumbnailUrl?: string;
  fallbackDescription?: string;
}

export interface AnimeProviderEpisode {
  id: string;
  number: number;
  title?: string;
  thumbnailUrl?: string;
  description?: string;
  durationMinutes?: number;
}

export interface AnimeProviderSeason {
  id: string;
  number: number;
  title: string;
  episodes: AnimeProviderEpisode[];
}

export interface AnimeEpisodeCatalog {
  status: "available" | "unavailable";
  provider: "anikoto";
  providerTitle?: string;
  seasons: AnimeProviderSeason[];
  message?: string;
  checkedAt: string;
}

export interface MalScore {
  malId: number;
  score?: number;
  rank?: number;
  scoredBy?: number;
  malUrl: string;
}

export interface MalRankingItem {
  malId: number;
  title: string;
  coverUrl?: string;
  score?: number;
  malUrl: string;
}

export interface LatestAnimeUpdate {
  media: AniListCatalogMedia;
  episode: number;
  airedAt: number;
}

export interface LatestUpdatesPage<T> {
  pageInfo: AniListPageInfo;
  items: T[];
}

export type MangaPublicationKind = "MANGA" | "MANHWA" | "MANHUA" | "OTHER";

export interface LatestMangaUpdate {
  mangaDexId: string;
  aniListId?: number;
  malId?: number;
  title: string;
  coverUrl?: string;
  coverUrlFallback?: string;
  chapter?: string;
  originalLanguage?: string;
  publicationKind: MangaPublicationKind;
  updatedAt: string;
  mangaDexUrl: string;
}

export interface MangaDexAvailabilityInput {
  aniListId: number;
  title: string;
}

export interface MangaDexChapterAvailability {
  aniListId: number;
  mangaDexId?: string;
  status: "available" | "unmapped" | "unavailable";
  translatedLanguage: string;
  latestChapter?: number;
  checkedAt: string;
  message?: string;
}

export interface MangaDexReaderInput {
  aniListId: number;
  title: string;
}

export interface MangaDexReaderChapter {
  id: string;
  number?: number;
  volume?: string;
  title?: string;
  translatedLanguage: string;
  groupName?: string;
  publishedAt?: string;
  pages: number;
}

export interface MangaDexReaderSession {
  status: "available" | "unmapped" | "unavailable";
  aniListId: number;
  mangaDexId?: string;
  publicationStatus?: "ongoing" | "completed" | "hiatus" | "cancelled";
  translatedLanguage: string;
  chapters: MangaDexReaderChapter[];
  message?: string;
}

export interface MangaDexPageInput {
  chapterId: string;
  page: number;
  quality?: "data" | "data-saver";
}

export interface MangaDexReaderPage {
  chapterId: string;
  page: number;
  pageCount: number;
  mimeType: string;
  imageBytes: ArrayBuffer;
}

export interface MangaEnrichment {
  status: "available" | "unavailable";
  aniListId: number;
  mangaBakaId?: number;
  title?: string;
  authors: string[];
  artists: string[];
  publishers: string[];
  year?: number;
  type?: string;
  publicationStatus?: string;
  rating?: number;
  popularity?: number;
  totalChapters?: number;
  mangaUpdatesId?: string;
  mangaUpdatesRating?: number;
  mangaUpdates?: MangaUpdatesEnrichment;
  message?: string;
  checkedAt: string;
}

export interface MangaUpdatesGroup {
  id: number;
  name: string;
  url?: string;
}

export interface MangaUpdatesEnrichment {
  status: "available" | "unavailable";
  seriesId: number;
  title?: string;
  url?: string;
  type?: string;
  latestChapter?: number;
  licensed?: boolean;
  completed?: boolean;
  groups: MangaUpdatesGroup[];
  message?: string;
  checkedAt: string;
}

export interface AnimePlaybackInput {
  aniListId: number;
  title: string;
  episode: number;
  providerEpisodeId?: string;
  audio?: "sub" | "dub";
}

export interface AnimePlaybackCandidate {
  id: string;
  label: string;
  kind: "embed";
  url: string;
  language?: string;
  provider?: string;
}

export interface AnimePlaybackResult {
  status: "available" | "unavailable";
  candidates: AnimePlaybackCandidate[];
  attemptedSources: string[];
  message?: string;
}

export interface PlaybackResume {
  aniListId: number;
  episode: number;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface SavePlaybackResumeInput {
  aniListId: number;
  episode: number;
  positionSeconds: number;
  durationSeconds: number;
}

export interface MangaReadingResume {
  aniListId: number;
  chapterId: string;
  chapterNumber?: number;
  progress: number;
  updatedAt: string;
}

export interface SaveMangaReadingResumeInput {
  aniListId: number;
  chapterId: string;
  chapterNumber?: number;
  progress: number;
}

export interface AniListNamedPerson {
  id: number;
  name: string;
  imageUrl?: string;
  role?: string;
}

export interface AniListRelation {
  relationType: string;
  media: AniListCatalogMedia;
}

export interface AniListExternalLink {
  site: string;
  url: string;
  type?: string;
}

export interface AniListListEntrySummary {
  id: number;
  status: AniListEntryStatus;
  score: number;
  progress: number;
}

export interface AniListMediaDetail extends AniListCatalogMedia {
  titleRomaji?: string;
  titleEnglish?: string;
  titleNative?: string;
  synonyms: string[];
  source?: string;
  countryOfOrigin?: string;
  duration?: number;
  startDate?: string;
  endDate?: string;
  studios: string[];
  producers: string[];
  characters: AniListNamedPerson[];
  staff: AniListNamedPerson[];
  relations: AniListRelation[];
  recommendations: AniListCatalogMedia[];
  externalLinks: AniListExternalLink[];
  trailerUrl?: string;
  listEntry?: AniListListEntrySummary;
}

export interface AniListEntry {
  id: number;
  status: AniListEntryStatus;
  score: number;
  progress: number;
  progressVolumes?: number;
  repeat: number;
  notes?: string;
  updatedAt: number;
  media: AniListMedia;
}

export interface AniListGroup {
  name: string;
  isCustomList: boolean;
  entries: AniListEntry[];
}

export interface AniListDashboard {
  profile: AniListProfile;
  animeLists: AniListGroup[];
  mangaLists: AniListGroup[];
  fetchedAt: string;
}

export type AniListAuthState =
  | { status: "signed-out" }
  | { status: "authorizing" }
  | { status: "signed-in"; profile: AniListProfile }
  | { status: "error"; message: string };

export interface UpdateAniListEntryInput {
  id: number;
  status?: AniListEntryStatus;
  score?: number;
  progress?: number;
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
}

export interface AniStreamBridge {
  getAppInfo(): Promise<AppInfo>;
  getAniListAuthState(): Promise<AniListAuthState>;
  startAniListLogin(): Promise<void>;
  logoutAniList(): Promise<void>;
  getCachedAniListDashboard(): Promise<AniListDashboard | undefined>;
  getAniListDashboard(): Promise<AniListDashboard>;
  searchAniList(query: string, type: AniListMediaType): Promise<AniListMedia[]>;
  browseAniList(input: BrowseAniListInput): Promise<AniListCatalogPage>;
  getAniListMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail>;
  addAniListEntry(mediaId: number): Promise<AniListListEntrySummary>;
  updateAniListEntry(input: UpdateAniListEntryInput): Promise<AniListListEntrySummary>;
  deleteAniListEntry(id: number): Promise<void>;
  getAnimeEpisodeCatalog(input: AnimeEpisodeCatalogInput): Promise<AnimeEpisodeCatalog>;
  getLatestAnimeUpdates(page: number): Promise<LatestUpdatesPage<LatestAnimeUpdate>>;
  getLatestMangaUpdates(page: number): Promise<LatestUpdatesPage<LatestMangaUpdate>>;
  getMalScore(type: AniListMediaType, malId: number): Promise<MalScore | undefined>;
  getMalTrendingFallback(type: AniListMediaType): Promise<MalRankingItem[]>;
  getMangaDexAvailability(
    media: MangaDexAvailabilityInput[],
  ): Promise<MangaDexChapterAvailability[]>;
  getMangaDexReader(input: MangaDexReaderInput): Promise<MangaDexReaderSession>;
  getMangaDexPage(input: MangaDexPageInput): Promise<MangaDexReaderPage>;
  getMangaEnrichment(aniListId: number): Promise<MangaEnrichment>;
  getAnimePlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult>;
  getPlaybackResume(aniListId: number): Promise<PlaybackResume | undefined>;
  savePlaybackResume(input: SavePlaybackResumeInput): Promise<void>;
  clearPlaybackResume(aniListId: number): Promise<void>;
  getMangaReadingResume(aniListId: number): Promise<MangaReadingResume | undefined>;
  saveMangaReadingResume(input: SaveMangaReadingResumeInput): Promise<void>;
  clearMangaReadingResume(aniListId: number): Promise<void>;
  onAniListAuthChanged(callback: (state: AniListAuthState) => void): () => void;
}
