import type { AniListFilterOptions } from "./anilist-filters";
import type {
  AiringSchedule,
  AiringScheduleInput,
  AniListAuthState,
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListDashboard,
  AniListListEntrySummary,
  AniListMediaDetail,
  AniListMediaType,
  AnimeEpisodeCatalog,
  AnimeEpisodeArt,
  AnimeEpisodeArtInput,
  AnimeSkipSegment,
  AnimeSkipTimesInput,
  AnimeEpisodeRanges,
  AnimeDirectPlayback,
  AnimeDirectSubtitle,
  AnimeDirectPlaybackInput,
  AnimeSeriesNode,
  TitlePreferences,
  AnimeEpisodeRangesInput,
  AnimeEpisodeCatalogInput,
  AnimePlaybackInput,
  AnimePlaybackResult,
  AppInfo,
  WindowControlAction,
  WindowState,
  BrowseAniListInput,
  LatestAnimeUpdate,
  LatestMangaUpdate,
  LatestUpdatesPage,
  MoreCatalogPage,
  MoreDetail,
  MoreLibrary,
  MoreSeasonDetail,
  MoreTitleProgress,
  MoreTitleRef,
  MoreTitleSnapshot,
  SimklStatus,
  SimklRow,
  PersonalizationSection,
  PersonalizationSettings,
  TitleFeedbackRef,
  TitleFeedbackValue,
  SimklProfile,
  SimklStats,
  SimklTitleRatings,
  PicturePalette,
  MoreTitleStatusAction,
  MoreTitleStatusResult,
  MoreTitleRating,
  MoreMediaType,
  MorePlayerSource,
  PrepareMorePlayerInput,
  MorePlaybackInput,
  MorePlaybackResume,
  SaveMorePlaybackResumeInput,
  MalRankingItem,
  MalScore,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexChapterCheckInput,
  MangaMirrorChapterInfo,
  MangaMirrorChapterInput,
  MangaMirrorPageInput,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaTitleSnapshot,
  MangaReadingResume,
  MangaReaderPreferences,
  PlaybackResume,
  ProviderReadiness,
  SaveMangaReaderPreferencesInput,
  UpdateAniListEntryInput,
} from "./contracts";
import type { MoreBrowseInput } from "./more-filters";
import type { ReaderSettings } from "./reader-settings";
import type { UpdatePreferences, UpdateStatus } from "./update-check";
import type { RestorePreview, RestoreSummary } from "./local-backup";
import type { TasteMap } from "./taste-map";
import type { PersonalAiringUpdate } from "./personal-library";
import type { BingeChange, BingeState } from "./binge";
import type {
  DownloadAddResult,
  DownloadChange,
  DownloadEpisodeRequest,
  DownloadsState,
} from "./downloads";
import type { LocalActivity, RecordActivityInput } from "./activity";
import type {
  DiscoveryFeed,
  DiscoveryFeedback,
  DiscoveryImpressionInput,
  MoreDiscoveryFeed,
  MoreDiscoveryFeedback,
} from "./discovery";

/**
 * The single source of truth for request/response IPC. Keeping channel names and
 * tuple arguments here makes the main-process handlers and narrow preload bridge
 * fail together at compile time when a contract changes.
 */
export interface IpcInvokeChannelMap {
  "app:update-status": { args: []; result: UpdateStatus };
  "app:check-updates": { args: []; result: UpdateStatus };
  "app:download-update": { args: []; result: UpdateStatus };
  "app:cancel-update-download": { args: []; result: UpdateStatus };
  "app:install-update": { args: []; result: boolean };
  "app:update-preferences": { args: []; result: UpdatePreferences };
  "app:set-update-preferences": {
    args: [preferences: Omit<UpdatePreferences, "supported">];
    result: UpdatePreferences;
  };
  "backup:export": { args: []; result: boolean };
  "backup:prepare": { args: []; result: RestorePreview | null };
  "backup:restore": { args: [token: string]; result: RestoreSummary };
  "backup:cancel": { args: [token: string]; result: void };
  "personal:anime-updates": { args: [mediaIds: number[]]; result: PersonalAiringUpdate[] };
  "activity:record": { args: [input: RecordActivityInput]; result: LocalActivity };
  "activity:list": { args: []; result: LocalActivity[] };
  "binge:state": { args: []; result: BingeState };
  "downloads:state": { args: []; result: DownloadsState };
  "downloads:add": { args: [episodes: DownloadEpisodeRequest[]]; result: DownloadAddResult };
  "downloads:apply": {
    args: [change: Exclude<DownloadChange, { op: "add" }>];
    result: DownloadsState;
  };
  "downloads:choose-folder": { args: []; result: DownloadsState | null };
  "binge:apply": { args: [change: BingeChange]; result: BingeState };
  "activity:retry": { args: []; result: LocalActivity[] };
  "app:get-info": { args: []; result: AppInfo };
  "app:open-link": { args: [url: string]; result: void };
  "window:caption-controls": { args: [visible: boolean]; result: void };
  "window:control": { args: [action: WindowControlAction]; result: void };
  "window:state": { args: []; result: WindowState };
  "anime:provider-readiness": { args: []; result: ProviderReadiness };
  "anilist:auth-state": { args: []; result: AniListAuthState };
  "anilist:login": { args: []; result: void };
  "anilist:cancel-login": { args: []; result: void };
  "anilist:logout": { args: []; result: void };
  "request:cancel": { args: [requestId: string]; result: void };
  "anilist:cached-dashboard": { args: []; result: AniListDashboard | undefined };
  "anilist:dashboard": { args: []; result: AniListDashboard };
  "anilist:browse": { args: [input: BrowseAniListInput]; result: AniListCatalogPage };
  "anilist:person-titles": {
    args: [kind: "character" | "studio", id: number, type: AniListMediaType];
    result: AniListCatalogMedia[];
  };
  "anilist:media-by-ids": {
    args: [ids: number[], type: AniListMediaType];
    result: AniListCatalogMedia[];
  };
  "anilist:media-detail": {
    args: [id: number, type: AniListMediaType];
    result: AniListMediaDetail;
  };
  "anilist:series-graph": { args: [id: number]; result: AnimeSeriesNode[] };
  "app:title-preferences": { args: []; result: TitlePreferences };
  "app:set-title-preferences": {
    args: [preferences: TitlePreferences];
    result: TitlePreferences;
  };
  "anilist:add-entry": { args: [mediaId: number]; result: AniListListEntrySummary };
  "anilist:update-entry": {
    args: [input: UpdateAniListEntryInput];
    result: AniListListEntrySummary;
  };
  "anilist:delete-entry": { args: [id: number]; result: { queued: boolean } };
  "anilist:pending-changes": { args: []; result: number };
  "anilist:schedule": { args: [input: AiringScheduleInput]; result: AiringSchedule };
  "anilist:filter-options": { args: []; result: AniListFilterOptions };
  "anilist:latest-anime": {
    args: [page: number];
    result: LatestUpdatesPage<LatestAnimeUpdate>;
  };
  "anime:episode-catalog": {
    args: [input: AnimeEpisodeCatalogInput];
    result: AnimeEpisodeCatalog;
  };
  "anime:episode-art": { args: [input: AnimeEpisodeArtInput]; result: AnimeEpisodeArt[] };
  "anime:skip-times": { args: [input: AnimeSkipTimesInput]; result: AnimeSkipSegment[] };
  "anime:direct-playback": {
    args: [input: AnimeDirectPlaybackInput];
    result: AnimeDirectPlayback;
  };
  "anime:direct-subtitle": { args: [id: string]; result: AnimeDirectSubtitle };
  "anime:episode-ranges": {
    args: [input: AnimeEpisodeRangesInput];
    result: AnimeEpisodeRanges | undefined;
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
  "mangadex:latest": {
    args: [page: number];
    result: LatestUpdatesPage<LatestMangaUpdate>;
  };
  "more:trending": {
    args: [type: MoreMediaType, page: number];
    result: MoreCatalogPage;
  };
  "more:browse": { args: [input: MoreBrowseInput]; result: MoreCatalogPage };
  "more:search": {
    args: [query: string, type: MoreMediaType, page: number];
    result: MoreCatalogPage;
  };
  "more:detail": {
    args: [id: number, type: MoreMediaType, priority: boolean];
    result: MoreDetail;
  };
  "more:season": { args: [id: number, season: number]; result: MoreSeasonDetail };
  "more:library": { args: []; result: MoreLibrary };
  "more:title-progress": { args: [input: MoreTitleRef]; result: MoreTitleProgress[] };
  "more:watchlist-set": { args: [title: MoreTitleSnapshot, saved: boolean]; result: void };
  "more:title-status": {
    args: [title: MoreTitleSnapshot, action: MoreTitleStatusAction];
    result: MoreTitleStatusResult;
  };
  "more:simkl-rows": { args: []; result: SimklRow[] };
  "personalization:settings": { args: []; result: PersonalizationSettings };
  "personalization:set-activity": { args: [on: boolean]; result: PersonalizationSettings };
  "personalization:set-hidden-tags": {
    args: [names: string[]];
    result: PersonalizationSettings;
  };
  "personalization:time-to-play": {
    args: [section: PersonalizationSection, seconds: number];
    result: void;
  };
  "personalization:feedback": { args: [ref: TitleFeedbackRef]; result: TitleFeedbackValue };
  "personalization:set-feedback": {
    args: [ref: TitleFeedbackRef, value: TitleFeedbackValue];
    result: void;
  };
  "more:rating": { args: [ref: MoreTitleRef]; result: MoreTitleRating };
  "more:rating-set": {
    args: [title: MoreTitleSnapshot, rating: number | null];
    result: MoreTitleStatusResult;
  };
  "more:remember": { args: [title: MoreTitleSnapshot]; result: void };
  "more:player-prepare": { args: [input: PrepareMorePlayerInput]; result: MorePlayerSource };
  "more:player-release": { args: []; result: void };
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
  "mangadex:chapter-readable": { args: [input: MangaDexChapterCheckInput]; result: boolean };
  "manga:mirror-chapter": {
    args: [input: MangaMirrorChapterInput];
    result: MangaMirrorChapterInfo;
  };
  "manga:mirror-page": { args: [input: MangaMirrorPageInput]; result: MangaDexReaderPage };
  "playback:resume": { args: [aniListId: number]; result: PlaybackResume | undefined };
  "manga:reading-resume": {
    args: [aniListId: number];
    result: MangaReadingResume | undefined;
  };
  "more:resume": { args: [input: MorePlaybackInput]; result: MorePlaybackResume | undefined };
  "more:save-resume": { args: [input: SaveMorePlaybackResumeInput]; result: void };
  "more:clear-resume": { args: [input: MorePlaybackInput]; result: void };
  "discovery:for-you": {
    args: [type: AniListMediaType, fresh?: boolean];
    result: DiscoveryFeed;
  };
  "reader:settings": { args: []; result: ReaderSettings };
  "reader:save-settings": { args: [input: ReaderSettings]; result: ReaderSettings };
  "discovery:feedback": { args: [input: DiscoveryFeedback]; result: void };
  "discovery:taste-map": { args: []; result: TasteMap };
  "discovery:impressions": { args: [input: DiscoveryImpressionInput]; result: void };
  "more:for-you": { args: [fresh?: boolean]; result: MoreDiscoveryFeed };
  "more:for-you-feedback": { args: [input: MoreDiscoveryFeedback]; result: void };
  "simkl:status": { args: []; result: SimklStatus };
  "simkl:connect": { args: []; result: void };
  "simkl:cancel": { args: []; result: void };
  "simkl:disconnect": { args: []; result: void };
  "simkl:sync": { args: []; result: void };
  "simkl:profile": { args: []; result: SimklProfile | undefined };
  "simkl:stats": { args: []; result: SimklStats | undefined };
  "simkl:title-ratings": { args: [ref: MoreTitleRef]; result: SimklTitleRatings | undefined };
  "profile:palette": { args: [url: string]; result: PicturePalette | undefined };
  "profile:hero": { args: []; result: string | undefined };
  "profile:hero-set": { args: [jpeg: Uint8Array]; result: string };
  "profile:hero-clear": { args: []; result: void };
}

export interface IpcEventChannelMap {
  "app:update-status-changed": UpdateStatus;
  "activity:changed": undefined;
  "downloads:changed": undefined;
  "anilist:auth-changed": AniListAuthState;
  "simkl:status-changed": SimklStatus;
}

export type IpcInvokeChannel = keyof IpcInvokeChannelMap;
export type IpcInvokeArgs<Channel extends IpcInvokeChannel> = IpcInvokeChannelMap[Channel]["args"];
export type IpcInvokeResult<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]["result"];
