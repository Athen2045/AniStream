import { contextBridge, ipcRenderer } from "electron";
import type { AniListAuthState, AniStreamBridge } from "../shared/contracts";
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from "../shared/ipc";

function invoke<Channel extends IpcInvokeChannel>(
  channel: Channel,
  ...args: IpcInvokeArgs<Channel>
): Promise<IpcInvokeResult<Channel>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<Channel>>;
}

const bridge: AniStreamBridge = {
  getAppInfo: () => invoke("app:get-info"),
  getAniListAuthState: () => invoke("anilist:auth-state"),
  startAniListLogin: () => invoke("anilist:login"),
  logoutAniList: () => invoke("anilist:logout"),
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
  getMangaDexAvailability: (media) => invoke("mangadex:availability", media),
  getMangaDexReader: (input) => invoke("mangadex:reader", input),
  getMangaDexPage: (input) => invoke("mangadex:page", input),
  getMangaEnrichment: (aniListId) => invoke("manga:enrichment", aniListId),
  getAnimePlayback: (input) => invoke("anime:playback", input),
  getPlaybackResume: (aniListId) => invoke("playback:resume", aniListId),
  savePlaybackResume: (input) => invoke("playback:save-resume", input),
  clearPlaybackResume: (aniListId) => invoke("playback:clear-resume", aniListId),
  getMangaReadingResume: (aniListId) => invoke("manga:reading-resume", aniListId),
  saveMangaReadingResume: (input) => invoke("manga:save-reading-resume", input),
  clearMangaReadingResume: (aniListId) => invoke("manga:clear-reading-resume", aniListId),
  onAniListAuthChanged: (callback: (state: AniListAuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AniListAuthState): void => {
      callback(state);
    };
    ipcRenderer.on("anilist:auth-changed", listener);
    return () => ipcRenderer.removeListener("anilist:auth-changed", listener);
  },
};

contextBridge.exposeInMainWorld("anistream", bridge);
