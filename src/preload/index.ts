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
  AnimeEpisodeCatalog,
  AnimeEpisodeCatalogInput,
  AnimeEpisodeGuide,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  MangaDexPageInput,
  MangaDexReaderInput,
  MangaDexReaderPage,
  MangaDexReaderSession,
  MangaEnrichment,
  AnimePlaybackInput,
  AnimePlaybackResult,
  PlaybackResume,
  SavePlaybackResumeInput,
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
  getAnimeEpisodeCatalog: (input: AnimeEpisodeCatalogInput) =>
    ipcRenderer.invoke("anime:episode-catalog", input) as Promise<AnimeEpisodeCatalog>,
  getMangaDexAvailability: (media: MangaDexAvailabilityInput[]) =>
    ipcRenderer.invoke("mangadex:availability", media) as Promise<MangaDexChapterAvailability[]>,
  getMangaDexReader: (input: MangaDexReaderInput) =>
    ipcRenderer.invoke("mangadex:reader", input) as Promise<MangaDexReaderSession>,
  getMangaDexPage: (input: MangaDexPageInput) =>
    ipcRenderer.invoke("mangadex:page", input) as Promise<MangaDexReaderPage>,
  getMangaEnrichment: (aniListId: number) =>
    ipcRenderer.invoke("manga:enrichment", aniListId) as Promise<MangaEnrichment>,
  getAnimePlayback: (input: AnimePlaybackInput) =>
    ipcRenderer.invoke("anime:playback", input) as Promise<AnimePlaybackResult>,
  getPlaybackResume: (aniListId: number) =>
    ipcRenderer.invoke("playback:resume", aniListId) as Promise<PlaybackResume | undefined>,
  savePlaybackResume: (input: SavePlaybackResumeInput) =>
    ipcRenderer.invoke("playback:save-resume", input) as Promise<void>,
  clearPlaybackResume: (aniListId: number) =>
    ipcRenderer.invoke("playback:clear-resume", aniListId) as Promise<void>,
  openTorrentMagnet: (magnetUrl: string) =>
    ipcRenderer.invoke("anime:open-torrent", magnetUrl) as Promise<void>,
  onAniListAuthChanged: (callback: (state: AniListAuthState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AniListAuthState): void => {
      callback(state);
    };
    ipcRenderer.on("anilist:auth-changed", listener);
    return () => ipcRenderer.removeListener("anilist:auth-changed", listener);
  },
};

contextBridge.exposeInMainWorld("anistream", bridge);
