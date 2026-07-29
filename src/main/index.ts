import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { AniListClient } from "./anilist";
import { getAnimeEpisodeGuide } from "./parse-anime";
import { MalClient } from "./mal";
import { MangaDexClient } from "./mangadex";
import { MangaBakaClient } from "./mangabaka";
import { AnimeTorrentSourceClient } from "./anime-sources";
import { AniwatchApiClient } from "./aniwatch";
import { loadEnvironmentFile } from "./config";
import { openAppDatabase, type AppDatabase } from "./database";
import { HlsProxy, registerHlsSchemePrivileges } from "./hls-proxy";
import { ZenshinEpisodeClient } from "./zenshin-episodes";
import type {
  AnimeEpisodeCatalogInput,
  AniListAuthState,
  AniListMediaType,
  AppInfo,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexPageInput,
  MangaDexReaderInput,
  AnimePlaybackInput,
  AnimePlaybackResult,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";

registerHlsSchemePrivileges();

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let aniList: AniListClient | undefined;
let mangaDex: MangaDexClient | undefined;
let mal: MalClient | undefined;
let mangaBaka: MangaBakaClient | undefined;
let animeTorrents: AnimeTorrentSourceClient | undefined;
let aniwatch: AniwatchApiClient | undefined;
let hlsProxy: HlsProxy | undefined;
let zenshinEpisodes: ZenshinEpisodeClient | undefined;
let pendingProtocolUrl: string | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // Standard macOS app default: matches the 1440x900 logical resolution of MacBook
    // displays so the window opens full-feeling without being maximized.
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#090b10",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function emitAniListState(state: AniListAuthState): void {
  mainWindow?.webContents.send("anilist:auth-changed", state);
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (!aniList) {
    pendingProtocolUrl = url;
    return;
  }

  await aniList.handleCallback(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleProtocolUrl(url);
});

app.whenReady().then(async () => {
  loadEnvironmentFile(join(process.cwd(), ".env"));
  loadEnvironmentFile(join(app.getPath("userData"), ".env"));
  database = openAppDatabase(join(app.getPath("userData"), "anistream.sqlite"));
  aniList = new AniListClient(
    join(app.getPath("userData"), "anilist-session.bin"),
    emitAniListState,
  );
  mangaDex = new MangaDexClient();
  mal = new MalClient();
  mangaBaka = new MangaBakaClient();
  animeTorrents = new AnimeTorrentSourceClient();
  hlsProxy = new HlsProxy();
  hlsProxy.register();
  if (isAniwatchEnabled()) aniwatch = new AniwatchApiClient(hlsProxy);
  zenshinEpisodes = new ZenshinEpisodeClient();
  app.setAsDefaultProtocolClient("anistream");
  await aniList.restore();

  ipcMain.handle("app:get-info", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    databaseReady: database?.ready ?? false,
    videoSourceStatus: aniwatch ? "configured" : "fallback-only",
  }));

  ipcMain.handle("anilist:auth-state", () => aniList?.getState() ?? { status: "signed-out" });
  ipcMain.handle("anilist:login", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.startLogin();
  });
  ipcMain.handle("anilist:logout", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.logout();
  });
  ipcMain.handle("anilist:dashboard", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getDashboard();
  });
  ipcMain.handle("anilist:search", async (_event, query: string, type: AniListMediaType) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.searchMedia(query, type);
  });
  ipcMain.handle("anilist:browse", async (_event, input: BrowseAniListInput) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.browseMedia(input);
  });
  ipcMain.handle("anilist:media-detail", async (_event, id: number, type: AniListMediaType) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getMediaDetail(id, type);
  });
  ipcMain.handle("anilist:add-entry", async (_event, mediaId: number) => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.addEntry(mediaId);
  });
  ipcMain.handle("anilist:update-entry", async (_event, input: UpdateAniListEntryInput) => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.updateEntry(input);
  });
  ipcMain.handle("anilist:delete-entry", async (_event, id: number) => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.deleteEntry(id);
  });
  ipcMain.handle("anime:episode-guide", async (_event, slug: string) => {
    return getAnimeEpisodeGuide(slug);
  });
  ipcMain.handle("anime:episode-catalog", async (_event, input: AnimeEpisodeCatalogInput) => {
    if (!zenshinEpisodes) throw new Error("Anime episode providers are not ready.");
    try {
      const zenshinCatalog = await zenshinEpisodes.getCatalog(input.aniListId);
      if (zenshinCatalog.status === "available") return zenshinCatalog;
      if (!aniwatch) return zenshinCatalog;
      const aniwatchCatalog = await aniwatch.getEpisodeCatalog(input);
      if (aniwatchCatalog.status === "available") return aniwatchCatalog;
      return {
        ...zenshinCatalog,
        message: [zenshinCatalog.message, aniwatchCatalog.message].filter(Boolean).join(" "),
      };
    } catch (reason) {
      return {
        status: "unavailable",
        provider: "zenshin",
        seasons: [],
        message:
          reason instanceof Error
            ? reason.message
            : "The configured Aniwatch provider is unavailable.",
        checkedAt: new Date().toISOString(),
      };
    }
  });
  ipcMain.handle("anilist:latest-anime", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getLatestAnimeUpdates();
  });
  ipcMain.handle("mal:score", async (_event, type: AniListMediaType, malId: number) => {
    if (!mal) throw new Error("MyAnimeList is not ready.");
    return mal.getScore(type, malId);
  });
  ipcMain.handle("mal:trending-fallback", async (_event, type: AniListMediaType) => {
    if (!mal) throw new Error("MyAnimeList is not ready.");
    return mal.getRanking(type);
  });
  ipcMain.handle("mangadex:latest", async () => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getLatestUpdates();
  });
  ipcMain.handle("mangadex:availability", async (_event, media: MangaDexAvailabilityInput[]) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getAvailability(media);
  });
  ipcMain.handle("mangadex:reader", async (_event, input: MangaDexReaderInput) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getReader(input);
  });
  ipcMain.handle("mangadex:page", async (_event, input: MangaDexPageInput) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getPage(input);
  });
  ipcMain.handle("manga:enrichment", async (_event, aniListId: number) => {
    if (!mangaBaka) throw new Error("MangaBaka is not ready.");
    return mangaBaka.getEnrichment(aniListId);
  });
  ipcMain.handle("anime:playback", async (_event, input: AnimePlaybackInput) => {
    if (!animeTorrents) throw new Error("Anime sources are not ready.");
    if (!aniwatch) return animeTorrents.getPlayback(input);
    const [hlsResult, torrentResult] = await Promise.allSettled([
      aniwatch.getPlayback(input),
      animeTorrents.getPlayback(input),
    ]);
    return combinePlaybackResults(hlsResult, torrentResult);
  });
  ipcMain.handle("playback:resume", (_event, aniListId: number) => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database.getPlaybackResume(aniListId);
  });
  ipcMain.handle("playback:save-resume", (_event, input: SavePlaybackResumeInput) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.savePlaybackResume(input);
  });
  ipcMain.handle("playback:clear-resume", (_event, aniListId: number) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.clearPlaybackResume(aniListId);
  });
  ipcMain.handle("anime:open-torrent", async (_event, magnetUrl: string) => {
    if (!magnetUrl.startsWith("magnet:?") || magnetUrl.length > 8_000) {
      throw new Error("Invalid torrent magnet URL.");
    }
    await shell.openExternal(magnetUrl);
  });

  createWindow();

  if (pendingProtocolUrl) {
    const callbackUrl = pendingProtocolUrl;
    pendingProtocolUrl = undefined;
    void handleProtocolUrl(callbackUrl);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database?.close();
});

function combinePlaybackResults(
  hlsResult: PromiseSettledResult<AnimePlaybackResult>,
  torrentResult: PromiseSettledResult<AnimePlaybackResult>,
): AnimePlaybackResult {
  const hls = hlsResult.status === "fulfilled" ? hlsResult.value : undefined;
  const torrents = torrentResult.status === "fulfilled" ? torrentResult.value : undefined;
  const candidates = [
    ...(hls?.candidates.filter((candidate) => candidate.kind === "hls") ?? []),
    ...(torrents?.candidates.filter((candidate) => candidate.kind === "torrent") ?? []),
  ];
  const attemptedSources = [
    ...new Set([
      ...(hls?.attemptedSources ?? ["aniwatch"]),
      ...(torrents?.attemptedSources ?? ["nyaa", "animetosho"]),
    ]),
  ];
  if (candidates.length) return { status: "available", candidates, attemptedSources };
  const hlsMessage =
    hls?.message ??
    (hlsResult.status === "rejected" && hlsResult.reason instanceof Error
      ? hlsResult.reason.message
      : undefined);
  const torrentMessage =
    torrents?.message ??
    (torrentResult.status === "rejected" && torrentResult.reason instanceof Error
      ? torrentResult.reason.message
      : undefined);
  return {
    status: "unavailable",
    candidates: [],
    attemptedSources,
    message:
      [hlsMessage, torrentMessage].filter(Boolean).join(" ") ||
      "No approved stream or torrent release is currently available.",
  };
}

function isAniwatchEnabled(): boolean {
  const configured = process.env.ANISTREAM_ANIWATCH_ENABLED?.trim().toLocaleLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}
