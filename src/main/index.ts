import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { AniListClient } from "./anilist";
import { openAppDatabase, type AppDatabase } from "./database";
import type {
  AniListAuthState,
  AniListMediaType,
  AppInfo,
  BrowseAniListInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let aniList: AniListClient | undefined;
let pendingProtocolUrl: string | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
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
  database = openAppDatabase(join(app.getPath("userData"), "anistream.sqlite"));
  aniList = new AniListClient(
    join(app.getPath("userData"), "anilist-session.bin"),
    emitAniListState,
  );
  app.setAsDefaultProtocolClient("anistream");
  await aniList.restore();

  ipcMain.handle("app:get-info", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    databaseReady: database?.ready ?? false,
    videoSourceStatus:
      process.env.VIDEO_HLS_SOURCE_ID?.trim() && process.env.VIDEO_TORRENT_INDEXER_IDS?.trim()
        ? "configured"
        : "approved-not-implemented",
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
