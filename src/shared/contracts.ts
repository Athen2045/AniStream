import type { AniListBrowseFilters, AniListFilterOptions } from "./anilist-filters";
import type { ReaderSettings } from "./reader-settings";
import type { RestorePreview, RestoreSummary } from "./local-backup";
import type { PersonalAiringUpdate } from "./personal-library";
import type { LocalActivity, RecordActivityInput } from "./activity";
import type {
  DiscoveryFeed,
  DiscoveryFeedback,
  DiscoveryImpressionInput,
  MoreDiscoveryFeed,
  MoreDiscoveryFeedback,
} from "./discovery";

export interface AppInfo {
  version: string;
  platform: string;
  databaseReady: boolean;
  videoSourceStatus: "configured" | "unavailable";
}

export interface ProviderReadiness {
  provider: "anime-source";
  status: "ready" | "disabled" | "offline" | "rate-limited" | "unavailable";
  checkedAt: string;
  message?: string;
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
  /** AniList's dominant cover color (`#rrggbb`); manga pages use it as a per-title accent. */
  coverColor?: string;
  /** AniList's fixed 1900×400 banner, when the title has one. */
  bannerUrl?: string;
  format?: string;
  status?: string;
  totalProgress?: number;
  totalVolumes?: number;
  genres?: string[];
  averageScore?: number;
  nextAiringEpisode?: AniListAiringTime;
  siteUrl: string;
}

/** One scheduled airing; `airingAt` is Unix seconds. */
export interface AniListAiringTime {
  episode: number;
  airingAt: number;
}

/** A week (or shorter span) of the airing schedule, in Unix seconds. */
export interface AiringScheduleInput {
  start: number;
  end: number;
  /** Limits the schedule to these titles (the user's list); omitted for everything airing. */
  mediaIds?: number[];
}

export interface AiringScheduleEntry extends AniListAiringTime {
  media: AniListCatalogMedia;
}

export interface AiringSchedule {
  entries: AiringScheduleEntry[];
  /** True when the bounded page budget ran out before the end of the span. */
  partial: boolean;
}

export interface AniListCatalogMedia extends AniListMedia {
  /** MAL cross-reference from AniList's own idMal field; enables MAL score lookups. */
  malId?: number;
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

export interface KitsuHeroArtworkInput {
  aniListId: number;
  type: AniListMediaType;
  title: string;
}

export interface KitsuHeroArtwork {
  source: "kitsu";
  imageUrl: string;
  width?: number;
  height?: number;
}

export interface BrowseAniListInput extends AniListBrowseFilters {
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
}

export interface AnimeProviderEpisode {
  id: string;
  number: number;
  title?: string;
  thumbnailUrl?: string;
  description?: string;
  durationMinutes?: number;
}

/** A TMDB still for one AniList episode (exact link, aligned by air date). */
export interface AnimeEpisodeArt {
  number: number;
  stillUrl: string;
}

export interface AnimeEpisodeArtInput {
  aniListId: number;
  episodes: number;
  focus: number;
}

export interface AnimeProviderSeason {
  id: string;
  number: number;
  title: string;
  episodes: AnimeProviderEpisode[];
}

export interface AnimeEpisodeCatalog {
  status: "available" | "unavailable";
  provider: "anime-source";
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
  /** MAL's summary; shown (with MAL credit) only when AniList has none. */
  synopsis?: string;
  /** MAL's English title; shown only when AniList has none. */
  englishTitle?: string;
  /** MAL genre names; shown only when AniList lists none. */
  genres?: string[];
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

export type MoreMediaType = "MOVIE" | "TV";

export interface MoreCatalogItem {
  id: number;
  type: MoreMediaType;
  title: string;
  originalTitle?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  year?: number;
  score?: number;
  voteCount?: number;
  genres: string[];
  runtimeMinutes?: number;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  siteUrl: string;
}

export interface MoreSeason {
  number: number;
  name: string;
  episodeCount?: number;
  overview?: string;
  posterUrl?: string;
  airDate?: string;
}

export interface MoreDetail extends MoreCatalogItem {
  seasons: MoreSeason[];
  status?: string;
  networks: string[];
  creators: string[];
  /** Transparent title artwork (TMDB logo), preferred over typeset titles in heroes. */
  logoUrl?: string;
  /** Full-resolution backdrop for full-bleed heroes; `backdropUrl` stays the bounded size. */
  heroBackdropUrl?: string;
  /** US content rating, e.g. "TV-MA" or "PG-13". */
  certification?: string;
  originalLanguage?: string;
  lastAirDate?: string;
  /** TV network or movie production company shown under the detail facts. */
  brandName?: string;
  brandLogoUrl?: string;
  /** Lead cast in billing order (up to 8). */
  cast: MoreCastMember[];
  /**
   * TMDB recommendations with enough votes to be meaningful; the detail handler drops titles the
   * viewer already watched and keeps the best 6.
   */
  recommendations: MoreCatalogItem[];
}

export interface MoreCastMember {
  name: string;
  character?: string;
  profileUrl?: string;
}

export interface MoreEpisode {
  number: number;
  name: string;
  overview?: string;
  stillUrl?: string;
  runtimeMinutes?: number;
  airDate?: string;
  score?: number;
}

export interface MoreSeasonDetail {
  seasonNumber: number;
  name: string;
  episodes: MoreEpisode[];
}

/** The minimal title metadata kept locally for the watch list and Continue Watching. */
export interface MoreTitleSnapshot {
  id: number;
  type: MoreMediaType;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  year?: number;
  score?: number;
}

export interface MoreTitleRef {
  tmdbId: number;
  type: MoreMediaType;
}

export interface MoreTitleProgress {
  season?: number;
  episode?: number;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface MoreContinueItem extends MoreTitleProgress {
  item: MoreCatalogItem;
}

export interface MoreLibrary {
  watchlist: MoreCatalogItem[];
  continueWatching: MoreContinueItem[];
  /** Marked "Completed (Already Watched)" here or on the connected Simkl account. */
  completed?: MoreTitleRef[];
}

export interface MorePageInfo {
  currentPage: number;
  totalPages: number;
  totalResults: number;
  hasNextPage: boolean;
}

export interface MoreCatalogPage {
  pageInfo: MorePageInfo;
  items: MoreCatalogItem[];
}

export interface MorePlaybackInput {
  tmdbId: number;
  type: MoreMediaType;
  season?: number;
  episode?: number;
}

export interface PrepareMorePlayerInput extends MorePlaybackInput {
  startAtSeconds?: number;
  /** Position in the configured player list: 0 is the primary, later ones are fallbacks. */
  providerIndex?: number;
}

/** Player URL built in main from the local provider config; the renderer frames it directly. */
export interface MorePlayerSource {
  url: string;
  /** Which configured player this URL came from, and how many are configured. */
  providerIndex: number;
  providerCount: number;
}

export interface MorePlaybackResume extends MorePlaybackInput {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface SaveMorePlaybackResumeInput extends MorePlaybackInput {
  positionSeconds: number;
  durationSeconds: number;
}

export interface MangaDexAvailabilityInput {
  aniListId: number;
  title: string;
  translatedLanguage?: string;
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
  translatedLanguage?: string;
  preferredGroupId?: string;
}

export interface MangaDexScanlationGroup {
  id: string;
  name: string;
}

export interface MangaDexReaderChapter {
  id: string;
  number?: number;
  volume?: string;
  title?: string;
  translatedLanguage: string;
  groups: MangaDexScanlationGroup[];
  groupName?: string;
  publishedAt?: string;
  /** Page count; 0 for a mirror chapter until it is opened (`getMangaMirrorChapter`). */
  pages: number;
  /**
   * Absent for MangaDex chapters. `mirror`: from the configured chapter-mirror fallback, which fills
   * English chapter numbers MangaDex lacks; pages load through `getMangaMirrorPage`.
   */
  source?: "mirror";
  /** Display credit for a mirror chapter. */
  sourceLabel?: string;
  /**
   * On a MangaDex chapter: the chapter mirror's copy of the same number, opened instead when
   * MangaDex cannot serve this chapter's images (MangaDex@Home allocation 404).
   */
  mirrorFallback?: { id: string; sourceLabel: string };
}

export interface MangaDexChapterCheckInput {
  chapterId: string;
}

export interface MangaMirrorChapterInput {
  chapterId: string;
}

export interface MangaMirrorChapterInfo {
  chapterId: string;
  pageCount: number;
}

export interface MangaMirrorPageInput {
  chapterId: string;
  page: number;
}

/** A chapter MangaDex lists only as a link to an official publisher site (not readable in-app). */
export interface MangaExternalChapter {
  id: string;
  number?: number;
  title?: string;
  /** https URL on the publisher site; opened in the system browser. */
  url: string;
  /** Display name of the publisher site. */
  site: string;
  translatedLanguage: string;
  publishedAt?: string;
}

export interface MangaDexReaderSession {
  status: "available" | "unmapped" | "unavailable";
  aniListId: number;
  mangaDexId?: string;
  publicationStatus?: "ongoing" | "completed" | "hiatus" | "cancelled";
  translatedLanguage: string;
  availableLanguages: string[];
  availableGroups: MangaDexScanlationGroup[];
  preferredGroupId?: string;
  archiveStatus: "complete" | "partial";
  chapters: MangaDexReaderChapter[];
  /** Publisher-hosted chapters in the chosen language; never part of in-app reading order. */
  externalChapters?: MangaExternalChapter[];
  /** MangaDex community statistics; absent when the optional statistics request failed. */
  statistics?: MangaDexStatistics;
  message?: string;
}

export interface MangaDexStatistics {
  /** Bayesian rating on MangaDex's 1–10 scale. */
  rating?: number;
  follows?: number;
}

export interface MangaReaderPreferences {
  aniListId: number;
  translatedLanguage: string;
  preferredGroupId?: string;
  updatedAt: string;
}

export interface SaveMangaReaderPreferencesInput {
  aniListId: number;
  translatedLanguage: string;
  preferredGroupId?: string;
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
  /** Official reading sites (web platforms and publishers) for this exact series. */
  readingLinks?: MangaReadingLink[];
  message?: string;
  checkedAt: string;
}

export interface MangaReadingLink {
  site: string;
  url: string;
  /** Language code as the provider reports it (e.g. "en", "es-la", "unknown"). */
  language: string;
}

export interface MangaChapterRange {
  from: number;
  to: number;
}

/**
 * Per-title chapter fallback: what exists beyond the chapters readable in-app. Built in main from
 * MangaDex publisher entries and MangaBaka's chapter total and official reading links.
 */
export interface MangaChapterFallback {
  translatedLanguage: string;
  /** Publisher-hosted chapters for numbers MangaDex cannot serve in-app. */
  externalChapters: MangaExternalChapter[];
  /** Whole-number chapter ranges no provider supplies, up to the series chapter total. */
  missingRanges: MangaChapterRange[];
  /** Official reading sites in the chosen language. */
  readingLinks: MangaReadingLink[];
  totalChapters?: number;
}

export type MangaTitleIssueSource =
  | "mangabaka"
  | "mangaupdates-series"
  | "mangaupdates-groups"
  | "mangadex-reader"
  | "chapter-mirror"
  | "resume";

export interface MangaTitleIssue {
  source: MangaTitleIssueSource;
  message: string;
}

/** One main-process-owned snapshot for the manga detail surface. Page bytes stay a separate seam. */
export interface MangaTitleSnapshot {
  aniListId: number;
  enrichment?: MangaEnrichment;
  reader?: MangaDexReaderSession;
  resume?: MangaReadingResume;
  preferences?: MangaReaderPreferences;
  /** Present when the manga chapter fallback is enabled and has something beyond in-app chapters. */
  chapterFallback?: MangaChapterFallback;
  issues: MangaTitleIssue[];
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
  /** AniList was unreachable: the edit is saved locally and sent when it is back. */
  queued?: boolean;
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
  /** Known future airings (up to 25), ascending by episode. */
  upcomingEpisodes?: AniListAiringTime[];
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

export type SimklAuthState =
  | { status: "disconnected" }
  | { status: "authorizing" }
  | {
      status: "connected";
      userName?: string;
      /** False for a grant made before AniStream asked to update Simkl; reconnect to allow it. */
      canWrite?: boolean;
      /** Simkl PRO or VIP: Custom Lists are readable. */
      premium?: boolean;
      avatarUrl?: string;
      joinedAt?: string;
    }
  | { status: "error"; message: string };

/** The Simkl connection plus what was imported from it; everything stays on this device. */
export interface SimklStatus {
  auth: SimklAuthState;
  library?: {
    movies: number;
    shows: number;
    /** Titles Simkl lists without a TMDB ID; AniStream cannot use them yet. */
    unmatched: number;
    syncedAt?: string;
    syncing: boolean;
    error?: string;
  };
}

/** One movie or show in the viewer's imported Simkl library (Profile → Movies / TV shows). */
export interface SimklLibraryItem {
  type: MoreMediaType;
  simklId: number;
  /** Absent when Simkl has no TMDB ID; such titles cannot open a More page. */
  tmdbId?: number;
  title: string;
  posterUrl?: string;
  year?: number;
  status: "watching" | "planning" | "paused" | "dropped" | "completed";
  /** The viewer's 1–10 rating on Simkl. */
  rating?: number;
  watchedEpisodes: number;
  totalEpisodes?: number;
  updatedAt: string;
}

/** Simkl's watch-time totals for the connected viewer (read when the profile opens, cached). */
export interface SimklStats {
  totalMinutes: number;
  movieMinutes: number;
  tvMinutes: number;
  /** Episodes watched across every TV list. */
  episodes: number;
}

/** What the profile shows for a connected Simkl account; everything stays on this device. */
export interface SimklProfile {
  name?: string;
  avatarUrl?: string;
  joinedAt?: string;
  stats?: SimklStats;
  items: SimklLibraryItem[];
}

/** Community scores for a More title from Simkl (and the IMDb score Simkl carries). */
export interface SimklTitleRatings {
  simkl?: { rating: number; votes: number };
  imdb?: { rating: number; votes: number };
  simklUrl: string;
  imdbUrl?: string;
}

/** Three colours taken from a profile picture, for the profile hero gradient. */
export type PicturePalette = [string, string, string];

/** A More row sourced from Simkl: a Trending file or one of the viewer's Custom Lists. */
export interface SimklRow {
  id: string;
  title: string;
  kind: "trending" | "list";
  /** The matching simkl.com page; Simkl asks apps to link back where its data appears. */
  link: string;
  items: MoreCatalogItem[];
}

/** Sections personalization measures and feeds. */
export type PersonalizationSection = "ANIME" | "MANGA" | "MORE";

/** Any title a viewer can mark from its detail page. */
export interface TitleFeedbackRef {
  type: "ANIME" | "MANGA" | "MOVIE" | "TV";
  id: number;
}

/** "Interested" / "Not interested" from a title page; null clears it. */
export type TitleFeedbackValue = "interested" | "not-interested" | null;

export interface TimeToPlaySummary {
  section: PersonalizationSection;
  /** Median seconds from opening the section to starting something, recent sessions. */
  medianSeconds: number;
  samples: number;
}

export interface PersonalizationSettings {
  /** Learn from how the viewer watches (starts, finishes, abandons, time to play). */
  activitySignals: boolean;
  timeToPlay: TimeToPlaySummary[];
}

export type MoreTitleStatusAction = "planning" | "unplanned" | "completed";

/** The viewer's own rating of a More title, and where Simkl shows it. */
export interface MoreTitleRating {
  /** 1–10; given here, or imported from Simkl. */
  rating?: number;
  /** Simkl's page for the title while Simkl is connected. */
  simklUrl?: string;
  /** Only completed titles can be rated (marked Completed, Completed on Simkl, or a finished movie). */
  canRate: boolean;
  /** Whether a new rating will reach Simkl (connected with write access). */
  syncsToSimkl: boolean;
}

/** Whether a "+" choice also reached the connected Simkl account. */
export interface MoreTitleStatusResult {
  simkl: "synced" | "skipped" | "failed";
  message?: string;
}

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
  getUpdateStatus(): Promise<import("./update-check").UpdateStatus>;
  checkForUpdates(): Promise<import("./update-check").UpdateStatus>;
  onUpdateStatusChanged(
    callback: (state: import("./update-check").UpdateStatus) => void,
  ): () => void;
  getForYou(type: AniListMediaType): Promise<DiscoveryFeed>;
  getReaderSettings(): Promise<ReaderSettings>;
  exportLocalBackup(): Promise<boolean>;
  prepareLocalRestore(): Promise<RestorePreview | null>;
  restoreLocalBackup(token: string): Promise<RestoreSummary>;
  cancelLocalRestore(token: string): Promise<void>;
  saveReaderSettings(input: ReaderSettings): Promise<ReaderSettings>;
  recordDiscoveryFeedback(input: DiscoveryFeedback): Promise<void>;
  recordDiscoveryImpressions(input: DiscoveryImpressionInput): Promise<void>;
  getMoreForYou(): Promise<MoreDiscoveryFeed>;
  recordMoreDiscoveryFeedback(input: MoreDiscoveryFeedback): Promise<void>;
  onActivityChanged(callback: () => void): () => void;
  getPersonalAnimeUpdates(mediaIds: number[]): Promise<PersonalAiringUpdate[]>;
  recordActivity(input: RecordActivityInput): Promise<LocalActivity>;
  getLocalActivity(): Promise<LocalActivity[]>;
  getBingeState(): Promise<import("./binge").BingeState>;
  applyBingeChange(change: import("./binge").BingeChange): Promise<import("./binge").BingeState>;
  retryActivitySync(): Promise<LocalActivity[]>;
  getAppInfo(): Promise<AppInfo>;
  /** Full-window media surfaces hide the native window controls along with their own. */
  setCaptionControlsVisible(visible: boolean): Promise<void>;
  getAnimeProviderReadiness(): Promise<ProviderReadiness>;
  getAniListAuthState(): Promise<AniListAuthState>;
  startAniListLogin(): Promise<void>;
  cancelAniListLogin(): Promise<void>;
  logoutAniList(): Promise<void>;
  getCachedAniListDashboard(): Promise<AniListDashboard | undefined>;
  getAniListDashboard(): Promise<AniListDashboard>;
  browseAniList(input: BrowseAniListInput): Promise<AniListCatalogPage>;
  getAniListFilterOptions(): Promise<AniListFilterOptions>;
  getAniListMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail>;
  /** Exact catalog titles by ID, in the order asked (at most 12). */
  getAniListMediaByIds(ids: number[], type: AniListMediaType): Promise<AniListCatalogMedia[]>;
  addAniListEntry(mediaId: number): Promise<AniListListEntrySummary>;
  updateAniListEntry(input: UpdateAniListEntryInput): Promise<AniListListEntrySummary>;
  deleteAniListEntry(id: number): Promise<{ queued: boolean }>;
  /** Library edits saved locally while AniList was unreachable, not yet sent. */
  getPendingAniListChanges(): Promise<number>;
  getAnimeEpisodeCatalog(input: AnimeEpisodeCatalogInput): Promise<AnimeEpisodeCatalog>;
  /** TMDB episode stills for an anime; empty when no exact TMDB match exists. */
  getAnimeEpisodeArt(input: AnimeEpisodeArtInput): Promise<AnimeEpisodeArt[]>;
  getLatestAnimeUpdates(page: number): Promise<LatestUpdatesPage<LatestAnimeUpdate>>;
  getAiringSchedule(input: AiringScheduleInput): Promise<AiringSchedule>;
  getLatestMangaUpdates(page: number): Promise<LatestUpdatesPage<LatestMangaUpdate>>;
  getMoreTrending(type: MoreMediaType, page: number): Promise<MoreCatalogPage>;
  searchMore(query: string, type: MoreMediaType, page: number): Promise<MoreCatalogPage>;
  /** Filtered More browsing/search (see `shared/more-filters`). */
  browseMore(input: import("./more-filters").MoreBrowseInput): Promise<MoreCatalogPage>;
  getMoreDetail(id: number, type: MoreMediaType): Promise<MoreDetail>;
  getMoreSeason(id: number, season: number): Promise<MoreSeasonDetail>;
  getMoreLibrary(): Promise<MoreLibrary>;
  getMoreTitleProgress(input: MoreTitleRef): Promise<MoreTitleProgress[]>;
  setMoreWatchlist(title: MoreTitleSnapshot, saved: boolean): Promise<void>;
  rememberMoreTitle(title: MoreTitleSnapshot): Promise<void>;
  prepareMorePlayer(input: PrepareMorePlayerInput): Promise<MorePlayerSource>;
  releaseMorePlayer(): Promise<void>;
  getMalScore(type: AniListMediaType, malId: number): Promise<MalScore | undefined>;
  getMalTrendingFallback(type: AniListMediaType): Promise<MalRankingItem[]>;
  getKitsuHeroArtwork(input: KitsuHeroArtworkInput): Promise<KitsuHeroArtwork | undefined>;
  getMangaDexAvailability(
    media: MangaDexAvailabilityInput[],
  ): Promise<MangaDexChapterAvailability[]>;
  getMangaTitleSnapshot(input: MangaDexReaderInput, requestId: string): Promise<MangaTitleSnapshot>;
  saveMangaReaderPreferences(
    input: SaveMangaReaderPreferencesInput,
  ): Promise<MangaReaderPreferences>;
  cancelRequest(requestId: string): Promise<void>;
  getMangaDexPage(input: MangaDexPageInput): Promise<MangaDexReaderPage>;
  getMangaMirrorChapter(input: MangaMirrorChapterInput): Promise<MangaMirrorChapterInfo>;
  /** False only when MangaDex says it cannot serve this chapter's images. */
  isMangaDexChapterReadable(input: MangaDexChapterCheckInput): Promise<boolean>;
  getMangaMirrorPage(input: MangaMirrorPageInput): Promise<MangaDexReaderPage>;
  getAnimePlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult>;
  getPlaybackResume(aniListId: number): Promise<PlaybackResume | undefined>;
  getMangaReadingResume(aniListId: number): Promise<MangaReadingResume | undefined>;
  getMorePlaybackResume(input: MorePlaybackInput): Promise<MorePlaybackResume | undefined>;
  saveMorePlaybackResume(input: SaveMorePlaybackResumeInput): Promise<void>;
  clearMorePlaybackResume(input: MorePlaybackInput): Promise<void>;
  onAniListAuthChanged(callback: (state: AniListAuthState) => void): () => void;
  getSimklStatus(): Promise<SimklStatus>;
  connectSimkl(): Promise<void>;
  cancelSimklConnect(): Promise<void>;
  disconnectSimkl(): Promise<void>;
  syncSimkl(): Promise<void>;
  setMoreTitleStatus(
    title: MoreTitleSnapshot,
    action: MoreTitleStatusAction,
  ): Promise<MoreTitleStatusResult>;
  getSimklRows(): Promise<SimklRow[]>;
  getPersonalizationSettings(): Promise<PersonalizationSettings>;
  setActivitySignals(on: boolean): Promise<PersonalizationSettings>;
  recordTimeToPlay(section: PersonalizationSection, seconds: number): Promise<void>;
  getTitleFeedback(ref: TitleFeedbackRef): Promise<TitleFeedbackValue>;
  setTitleFeedback(ref: TitleFeedbackRef, value: TitleFeedbackValue): Promise<void>;
  getMoreRating(ref: MoreTitleRef): Promise<MoreTitleRating>;
  setMoreRating(title: MoreTitleSnapshot, rating: number | null): Promise<MoreTitleStatusResult>;
  onSimklStatusChanged(callback: (status: SimklStatus) => void): () => void;
  getSimklProfile(): Promise<SimklProfile | undefined>;
  getSimklStats(): Promise<SimklStats | undefined>;
  getSimklTitleRatings(ref: MoreTitleRef): Promise<SimklTitleRatings | undefined>;
  getPicturePalette(url: string): Promise<PicturePalette | undefined>;
  /** The viewer's own profile hero as a `data:` URL, or undefined. */
  getProfileHero(): Promise<string | undefined>;
  /** Saves an already cropped JPEG (at most 4 MB); returns it as a `data:` URL. */
  setProfileHero(jpeg: Uint8Array): Promise<string>;
  clearProfileHero(): Promise<void>;
}
