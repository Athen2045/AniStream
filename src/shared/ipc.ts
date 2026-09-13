import type {
  AniListAuthState,
  AniListCatalogPage,
  AniListDashboard,
  AniListListEntrySummary,
  AniListMedia,
  AniListMediaDetail,
  AniListMediaType,
  AnimeEpisodeCatalog,
  AnimeEpisodeCatalogInput,
  AnimePlaybackInput,
  AnimePlaybackResult,
  AppInfo,
  BrowseAniListInput,
  LatestAnimeUpdate,
  LatestMangaUpdate,
  LatestUpdatesPage,
  KitsuHeroArtwork,
  KitsuHeroArtworkInput,
  MalRankingItem,
  MalScore,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaTitleSnapshot,
  MangaReadingResume,
  MangaReaderPreferences,
  PlaybackResume,
  ProviderReadiness,
  SaveMangaReadingResumeInput,
  SaveMangaReaderPreferencesInput,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "./contracts";
import type { ReaderSettings } from "./reader-settings";
import type { UpdateStatus } from "./update-check";
import type { RestorePreview, RestoreSummary } from "./local-backup";
import type { PersonalAiringUpdate, ReleaseAcknowledgement } from "./personal-library";
import type { LocalActivity, RecordActivityInput } from "./activity";
import type { DiscoveryFeed, DiscoveryFeedback, DiscoveryImpressionInput } from "./discovery";

/**
 * The single source of truth for request/response IPC. Keeping channel names and
 * tuple arguments here makes the main-process handlers and narrow preload bridge
 * fail together at compile time when a contract changes.
 */
export interface IpcInvokeChannelMap {
  "app:update-status": { args: []; result: UpdateStatus };
  "app:check-updates": { args: []; result: UpdateStatus };
  "backup:export": { args: []; result: boolean };
  "backup:prepare": { args: []; result: RestorePreview | null };
  "backup:restore": { args: [token: string]; result: RestoreSummary };
  "backup:cancel": { args: [token: string]; result: void };
  "personal:anime-updates": { args: [mediaIds: number[]]; result: PersonalAiringUpdate[] };
  "personal:acknowledgements": { args: []; result: ReleaseAcknowledgement[] };
  "personal:acknowledge": { args: [input: ReleaseAcknowledgement]; result: void };
  "activity:record": { args: [input: RecordActivityInput]; result: LocalActivity };
  "activity:list": { args: []; result: LocalActivity[] };
  "activity:retry": { args: []; result: LocalActivity[] };
  "app:get-info": { args: []; result: AppInfo };
  "anime:provider-readiness": { args: []; result: ProviderReadiness };
  "anilist:auth-state": { args: []; result: AniListAuthState };
  "anilist:login": { args: []; result: void };
  "anilist:cancel-login": { args: []; result: void };
  "anilist:logout": { args: []; result: void };
  "request:cancel": { args: [requestId: string]; result: void };
  "anilist:cached-dashboard": { args: []; result: AniListDashboard | undefined };
  "anilist:dashboard": { args: []; result: AniListDashboard };
  "anilist:search": { args: [query: string, type: AniListMediaType]; result: AniListMedia[] };
  "anilist:browse": { args: [input: BrowseAniListInput]; result: AniListCatalogPage };
  "anilist:media-detail": {
    args: [id: number, type: AniListMediaType];
    result: AniListMediaDetail;
  };
  "anilist:add-entry": { args: [mediaId: number]; result: AniListListEntrySummary };
  "anilist:update-entry": {
    args: [input: UpdateAniListEntryInput];
    result: AniListListEntrySummary;
  };
  "anilist:delete-entry": { args: [id: number]; result: void };
  "anilist:latest-anime": {
    args: [page: number];
    result: LatestUpdatesPage<LatestAnimeUpdate>;
  };
  "anime:episode-catalog": {
    args: [input: AnimeEpisodeCatalogInput];
    result: AnimeEpisodeCatalog;
  };
  "anime:playback": { args: [input: AnimePlaybackInput]; result: AnimePlaybackResult };
  "mal:score": {
    args: [type: AniListMediaType, malId: number];
    result: MalScore | undefined;
  };
  "mal:trending-fallback": {
    args: [type: AniListMediaType];
    result: MalRankingItem[];
  };
  "kitsu:hero-art": {
    args: [input: KitsuHeroArtworkInput];
    result: KitsuHeroArtwork | undefined;
  };
  "mangadex:latest": {
    args: [page: number];
    result: LatestUpdatesPage<LatestMangaUpdate>;
  };
  "mangadex:availability": {
    args: [media: MangaDexAvailabilityInput[]];
    result: MangaDexChapterAvailability[];
  };
  "manga:title-snapshot": {
    args: [input: MangaDexReaderInput, requestId: string];
    result: MangaTitleSnapshot;
  };
  "manga:save-reader-preferences": {
    args: [input: SaveMangaReaderPreferencesInput];
    result: MangaReaderPreferences;
  };
  "mangadex:page": { args: [input: MangaDexPageInput]; result: MangaDexReaderPage };
  "playback:resume": { args: [aniListId: number]; result: PlaybackResume | undefined };
  "playback:save-resume": { args: [input: SavePlaybackResumeInput]; result: void };
  "playback:clear-resume": { args: [aniListId: number]; result: void };
  "manga:reading-resume": {
    args: [aniListId: number];
    result: MangaReadingResume | undefined;
  };
  "manga:save-reading-resume": {
    args: [input: SaveMangaReadingResumeInput];
    result: void;
  };
  "manga:clear-reading-resume": { args: [aniListId: number]; result: void };
  "discovery:for-you": { args: [type: AniListMediaType]; result: DiscoveryFeed };
  "reader:settings": { args: []; result: ReaderSettings };
  "reader:save-settings": { args: [input: ReaderSettings]; result: ReaderSettings };
  "discovery:feedback": { args: [input: DiscoveryFeedback]; result: void };
  "discovery:impressions": { args: [input: DiscoveryImpressionInput]; result: void };
}

export interface IpcEventChannelMap {
  "app:update-status-changed": UpdateStatus;
  "activity:changed": undefined;
  "anilist:auth-changed": AniListAuthState;
}

export type IpcInvokeChannel = keyof IpcInvokeChannelMap;
export type IpcInvokeArgs<Channel extends IpcInvokeChannel> = IpcInvokeChannelMap[Channel]["args"];
export type IpcInvokeResult<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]["result"];
