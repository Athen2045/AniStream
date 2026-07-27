import { contextBridge, ipcRenderer } from "electron";
import type {
  AniListAuthState,
  AniListCatalogPage,
  AniListDashboard,
  AniListMedia,
  AniListMediaDetail,
  AniListMediaType,
  AniStreamBridge,
  AppInfo,
  AnimeEpisodeGuide,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  UpdateAniListEntryInput,
} from "../shared/contracts";

const bridge: AniStreamBridge = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
  getAniListAuthState: () => ipcRenderer.invoke("anilist:auth-state") as Promise<AniListAuthState>,
  startAniListLogin: () => ipcRenderer.invoke("anilist:login") as Promise<void>,
  logoutAniList: () => ipcRenderer.invoke("anilist:logout") as Promise<void>,
  getAniListDashboard: () => ipcRenderer.invoke("anilist:dashboard") as Promise<AniListDashboard>,
  searchAniList: (query: string, type: AniListMediaType) =>
    ipcRenderer.invoke("anilist:search", query, type) as Promise<AniListMedia[]>,
  browseAniList: (input: BrowseAniListInput) =>
    ipcRenderer.invoke("anilist:browse", input) as Promise<AniListCatalogPage>,
  getAniListMediaDetail: (id: number, type: AniListMediaType) =>
    ipcRenderer.invoke("anilist:media-detail", id, type) as Promise<AniListMediaDetail>,
  addAniListEntry: (mediaId: number) =>
    ipcRenderer.invoke("anilist:add-entry", mediaId) as Promise<void>,
  updateAniListEntry: (input: UpdateAniListEntryInput) =>
    ipcRenderer.invoke("anilist:update-entry", input) as Promise<void>,
  deleteAniListEntry: (id: number) =>
    ipcRenderer.invoke("anilist:delete-entry", id) as Promise<void>,
  getAnimeEpisodeGuide: (slug: string) =>
    ipcRenderer.invoke("anime:episode-guide", slug) as Promise<AnimeEpisodeGuide>,
  getMangaDexAvailability: (media: MangaDexAvailabilityInput[]) =>
    ipcRenderer.invoke("mangadex:availability", media) as Promise<MangaDexChapterAvailability[]>,
  onAniListAuthChanged: (callback: (state: AniListAuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AniListAuthState): void => {
      callback(state);
    };
    ipcRenderer.on("anilist:auth-changed", listener);
    return () => ipcRenderer.removeListener("anilist:auth-changed", listener);
  },
};

contextBridge.exposeInMainWorld("anistream", bridge);
