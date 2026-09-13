import { contextBridge, ipcRenderer } from "electron";
import type { AniListAuthState, AniStreamBridge } from "../shared/contracts";
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
  getReleaseAcknowledgements: () => invoke("personal:acknowledgements"),
  acknowledgeRelease: (input) => invoke("personal:acknowledge", input),
  recordActivity: (input) => invoke("activity:record", input),
  getLocalActivity: () => invoke("activity:list"),
  retryActivitySync: () => invoke("activity:retry"),
  getAppInfo: () => invoke("app:get-info"),
  getAnimeProviderReadiness: () => invoke("anime:provider-readiness"),
  getAniListAuthState: () => invoke("anilist:auth-state"),
  startAniListLogin: () => invoke("anilist:login"),
  cancelAniListLogin: () => invoke("anilist:cancel-login"),
  logoutAniList: () => invoke("anilist:logout"),
  cancelRequest: (requestId) => invoke("request:cancel", requestId),
  getCachedAniListDashboard: () => invoke("anilist:cached-dashboard"),
  getAniListDashboard: () => invoke("anilist:dashboard"),
  searchAniList: (query, type) => invoke("anilist:search", query, type),
  browseAniList: (input) => invoke("anilist:browse", input),
  getAniListMediaDetail: (id, type) => invoke("anilist:media-detail", id, type),
  addAniListEntry: (mediaId) => invoke("anilist:add-entry", mediaId),
  updateAniListEntry: (input) => invoke("anilist:update-entry", input),
  deleteAniListEntry: (id) => invoke("anilist:delete-entry", id),
  getAnimeEpisodeCatalog: (input) => invoke("anime:episode-catalog", input),
  getLatestAnimeUpdates: (page) => invoke("anilist:latest-anime", page),
  getLatestMangaUpdates: (page) => invoke("mangadex:latest", page),
  getMalScore: (type, malId) => invoke("mal:score", type, malId),
  getMalTrendingFallback: (type) => invoke("mal:trending-fallback", type),
  getKitsuHeroArtwork: (input) => invoke("kitsu:hero-art", input),
  getMangaDexAvailability: (media) => invoke("mangadex:availability", media),
  getMangaTitleSnapshot: (input, requestId) => invoke("manga:title-snapshot", input, requestId),
  saveMangaReaderPreferences: (input) => invoke("manga:save-reader-preferences", input),
  getMangaDexPage: (input) => invoke("mangadex:page", input),
  getAnimePlayback: (input) => invoke("anime:playback", input),
  getPlaybackResume: (aniListId) => invoke("playback:resume", aniListId),
  savePlaybackResume: (input) => invoke("playback:save-resume", input),
  clearPlaybackResume: (aniListId) => invoke("playback:clear-resume", aniListId),
  getMangaReadingResume: (aniListId) => invoke("manga:reading-resume", aniListId),
  saveMangaReadingResume: (input) => invoke("manga:save-reading-resume", input),
  clearMangaReadingResume: (aniListId) => invoke("manga:clear-reading-resume", aniListId),
  getForYou: (type) => invoke("discovery:for-you", type),
  recordDiscoveryFeedback: (input) => invoke("discovery:feedback", input),
  recordDiscoveryImpressions: (input) => invoke("discovery:impressions", input),
  onAniListAuthChanged: (callback: (state: AniListAuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AniListAuthState): void => {
      callback(state);
    };
    ipcRenderer.on("anilist:auth-changed", listener);
    return () => ipcRenderer.removeListener("anilist:auth-changed", listener);
  },
};

contextBridge.exposeInMainWorld("anistream", bridge);
