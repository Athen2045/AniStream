import { contextBridge, ipcRenderer } from "electron";
import type { AniListAuthState, AniStreamBridge, SimklStatus } from "../shared/contracts";
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from "../shared/ipc";
import type { UpdateStatus } from "../shared/update-check";
import { normalizeIpcError } from "./ipc-error";

function invoke<Channel extends IpcInvokeChannel>(
  channel: Channel,
  ...args: IpcInvokeArgs<Channel>
): Promise<IpcInvokeResult<Channel>> {
  return (ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<Channel>>).catch(
    (reason: unknown) => {
      throw normalizeIpcError(reason, channel);
    },
  );
}

const bridge: AniStreamBridge = {
  getUpdateStatus: () => invoke("app:update-status"),
  checkForUpdates: () => invoke("app:check-updates"),
  onUpdateStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateStatus): void =>
      callback(state);
    ipcRenderer.on("app:update-status-changed", listener);
    return () => ipcRenderer.removeListener("app:update-status-changed", listener);
  },
  exportLocalBackup: () => invoke("backup:export"),
  prepareLocalRestore: () => invoke("backup:prepare"),
  restoreLocalBackup: (token) => invoke("backup:restore", token),
  cancelLocalRestore: (token) => invoke("backup:cancel", token),
  getReaderSettings: () => invoke("reader:settings"),
  saveReaderSettings: (input) => invoke("reader:save-settings", input),
  onActivityChanged: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on("activity:changed", listener);
    return () => ipcRenderer.removeListener("activity:changed", listener);
  },
  getPersonalAnimeUpdates: (mediaIds) => invoke("personal:anime-updates", mediaIds),
  recordActivity: (input) => invoke("activity:record", input),
  getLocalActivity: () => invoke("activity:list"),
  getBingeState: () => invoke("binge:state"),
  applyBingeChange: (change) => invoke("binge:apply", change),
  retryActivitySync: () => invoke("activity:retry"),
  getAppInfo: () => invoke("app:get-info"),
  setCaptionControlsVisible: (visible) => invoke("window:caption-controls", visible),
  getAnimeProviderReadiness: () => invoke("anime:provider-readiness"),
  getAniListAuthState: () => invoke("anilist:auth-state"),
  startAniListLogin: () => invoke("anilist:login"),
  cancelAniListLogin: () => invoke("anilist:cancel-login"),
  logoutAniList: () => invoke("anilist:logout"),
  cancelRequest: (requestId) => invoke("request:cancel", requestId),
  getCachedAniListDashboard: () => invoke("anilist:cached-dashboard"),
  getAniListDashboard: () => invoke("anilist:dashboard"),
  browseAniList: (input) => invoke("anilist:browse", input),
  getAniListFilterOptions: () => invoke("anilist:filter-options"),
  getAniListMediaDetail: (id, type) => invoke("anilist:media-detail", id, type),
  getAniListMediaByIds: (ids, type) => invoke("anilist:media-by-ids", ids, type),
  addAniListEntry: (mediaId) => invoke("anilist:add-entry", mediaId),
  updateAniListEntry: (input) => invoke("anilist:update-entry", input),
  deleteAniListEntry: (id) => invoke("anilist:delete-entry", id),
  getPendingAniListChanges: () => invoke("anilist:pending-changes"),
  getAnimeEpisodeCatalog: (input) => invoke("anime:episode-catalog", input),
  getAnimeEpisodeArt: (input) => invoke("anime:episode-art", input),
  getLatestAnimeUpdates: (page) => invoke("anilist:latest-anime", page),
  getAiringSchedule: (input) => invoke("anilist:schedule", input),
  getLatestMangaUpdates: (page) => invoke("mangadex:latest", page),
  getMoreTrending: (type, page) => invoke("more:trending", type, page),
  searchMore: (query, type, page) => invoke("more:search", query, type, page),
  browseMore: (input) => invoke("more:browse", input),
  getMoreDetail: (id, type) => invoke("more:detail", id, type),
  getMoreSeason: (id, season) => invoke("more:season", id, season),
  getMoreLibrary: () => invoke("more:library"),
  getMoreTitleProgress: (input) => invoke("more:title-progress", input),
  setMoreWatchlist: (title, saved) => invoke("more:watchlist-set", title, saved),
  rememberMoreTitle: (title) => invoke("more:remember", title),
  prepareMorePlayer: (input) => invoke("more:player-prepare", input),
  releaseMorePlayer: () => invoke("more:player-release"),
  getMalScore: (type, malId) => invoke("mal:score", type, malId),
  getMalTrendingFallback: (type) => invoke("mal:trending-fallback", type),
  getKitsuHeroArtwork: (input) => invoke("kitsu:hero-art", input),
  getMangaDexAvailability: (media) => invoke("mangadex:availability", media),
  getMangaTitleSnapshot: (input, requestId) => invoke("manga:title-snapshot", input, requestId),
  saveMangaReaderPreferences: (input) => invoke("manga:save-reader-preferences", input),
  getMangaDexPage: (input) => invoke("mangadex:page", input),
  getMangaMirrorChapter: (input) => invoke("manga:mirror-chapter", input),
  isMangaDexChapterReadable: (input) => invoke("mangadex:chapter-readable", input),
  getMangaMirrorPage: (input) => invoke("manga:mirror-page", input),
  getAnimePlayback: (input) => invoke("anime:playback", input),
  getPlaybackResume: (aniListId) => invoke("playback:resume", aniListId),
  getMangaReadingResume: (aniListId) => invoke("manga:reading-resume", aniListId),
  getMorePlaybackResume: (input) => invoke("more:resume", input),
  saveMorePlaybackResume: (input) => invoke("more:save-resume", input),
  clearMorePlaybackResume: (input) => invoke("more:clear-resume", input),
  getForYou: (type) => invoke("discovery:for-you", type),
  recordDiscoveryFeedback: (input) => invoke("discovery:feedback", input),
  recordDiscoveryImpressions: (input) => invoke("discovery:impressions", input),
  getMoreForYou: () => invoke("more:for-you"),
  recordMoreDiscoveryFeedback: (input) => invoke("more:for-you-feedback", input),
  onAniListAuthChanged: (callback: (state: AniListAuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AniListAuthState): void => {
      callback(state);
    };
    ipcRenderer.on("anilist:auth-changed", listener);
    return () => ipcRenderer.removeListener("anilist:auth-changed", listener);
  },
  getSimklStatus: () => invoke("simkl:status"),
  connectSimkl: () => invoke("simkl:connect"),
  cancelSimklConnect: () => invoke("simkl:cancel"),
  disconnectSimkl: () => invoke("simkl:disconnect"),
  syncSimkl: () => invoke("simkl:sync"),
  setMoreTitleStatus: (title, action) => invoke("more:title-status", title, action),
  getSimklRows: () => invoke("more:simkl-rows"),
  getPersonalizationSettings: () => invoke("personalization:settings"),
  setActivitySignals: (on) => invoke("personalization:set-activity", on),
  recordTimeToPlay: (section, seconds) => invoke("personalization:time-to-play", section, seconds),
  getTitleFeedback: (ref) => invoke("personalization:feedback", ref),
  setTitleFeedback: (ref, value) => invoke("personalization:set-feedback", ref, value),
  getMoreRating: (ref) => invoke("more:rating", ref),
  setMoreRating: (title, rating) => invoke("more:rating-set", title, rating),
  getSimklProfile: () => invoke("simkl:profile"),
  getSimklStats: () => invoke("simkl:stats"),
  getSimklTitleRatings: (ref) => invoke("simkl:title-ratings", ref),
  getPicturePalette: (url) => invoke("profile:palette", url),
  getProfileHero: () => invoke("profile:hero"),
  setProfileHero: (jpeg) => invoke("profile:hero-set", jpeg),
  clearProfileHero: () => invoke("profile:hero-clear"),
  onSimklStatusChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SimklStatus): void =>
      callback(status);
    ipcRenderer.on("simkl:status-changed", listener);
    return () => ipcRenderer.removeListener("simkl:status-changed", listener);
  },
};

contextBridge.exposeInMainWorld("anistream", bridge);
