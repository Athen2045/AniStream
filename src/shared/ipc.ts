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
  MalRankingItem,
  MalScore,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaTitleSnapshot,
  MangaReadingResume,
  PlaybackResume,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "./contracts";

/**
 * The single source of truth for request/response IPC. Keeping channel names and
 * tuple arguments here makes the main-process handlers and narrow preload bridge
 * fail together at compile time when a contract changes.
 */
export interface IpcInvokeChannelMap {
  "app:get-info": { args: []; result: AppInfo };
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
}

export interface IpcEventChannelMap {
  "anilist:auth-changed": AniListAuthState;
}

export type IpcInvokeChannel = keyof IpcInvokeChannelMap;
export type IpcInvokeArgs<Channel extends IpcInvokeChannel> = IpcInvokeChannelMap[Channel]["args"];
export type IpcInvokeResult<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]["result"];
