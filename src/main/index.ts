import { join } from "node:path";
import { app, BrowserWindow, session, shell } from "electron";
import { AniListClient } from "./anilist";
import { AnikotoClient } from "./anikoto";
import { MalClient } from "./mal";
import { MangaDexClient } from "./mangadex";
import { MangaBakaClient } from "./mangabaka";
import { MangaUpdatesClient } from "./mangaupdates";
import { MangaTitleModule } from "./manga-title";
import { loadEnvironmentFile } from "./config";
import { openAppDatabase, type AppDatabase } from "./database";
import { startRendererServer, type RendererServer } from "./renderer-server";
import { registerTrustedIpcHandler, sendTypedIpcEvent } from "./ipc";
import { registerTrackerDomain } from "./domains/tracker";
import { registerAnimeDomain } from "./domains/anime";
import { registerMangaDomain } from "./domains/manga";
import { registerResumeDomain } from "./domains/resume";
import type { AniListAuthState, AppInfo } from "../shared/contracts";
import { ProtocolCallbackRouter } from "./protocol-callback-router";

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let aniList: AniListClient | undefined;
let anikoto: AnikotoClient | undefined;
let mangaDex: MangaDexClient | undefined;
let mal: MalClient | undefined;
let mangaBaka: MangaBakaClient | undefined;
let mangaUpdates: MangaUpdatesClient | undefined;
let mangaTitle: MangaTitleModule | undefined;
let rendererServer: RendererServer | undefined;
const protocolCallbacks = new ProtocolCallbackRouter();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const callbackUrl = commandLine.find((argument) => argument.startsWith("anistream://"));
    if (callbackUrl) protocolCallbacks.route(callbackUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(rendererUrl: string): void {
  mainWindow = new BrowserWindow({
    // Standard macOS app default: matches the 1440x900 logical resolution of MacBook
    // displays so the window opens full-feeling without being maximized.
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: process.platform === "win32",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: "#0d0f12",
            symbolColor: "#f3f5f7",
            height: 56,
          },
          roundedCorners: true,
          backgroundMaterial: "none",
        }
      : {}),
    backgroundColor: "#0d0f12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: !app.isPackaged,
    },
  });

  if (process.platform === "win32") mainWindow.setMenuBarVisibility(false);

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  void mainWindow.loadURL(rendererUrl).catch((error: unknown) => {
    console.error("AniStream renderer failed to load.", error);
    mainWindow?.show();
  });

  const trustedRendererOrigin = new URL(rendererUrl).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url, referrer }) => {
    // MegaPlay embeds can request ad/pop-up windows. Keep the playback surface in-app and
    // never hand provider-created windows to the user's external browser.
    if (safeOrigin(referrer.url) === MEGAPLAY_ORIGIN) return { action: "deny" };
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (safeOrigin(url) === trustedRendererOrigin) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

const MEGAPLAY_ORIGIN = "https://megaplay.buzz";

function emitAniListState(state: AniListAuthState): void {
  if (mainWindow) sendTypedIpcEvent(mainWindow.webContents, "anilist:auth-changed", state);
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (!aniList) return;

  await aniList.handleCallback(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  protocolCallbacks.route(url);
});

const initialProtocolUrl = process.argv.find((argument) => argument.startsWith("anistream://"));
if (initialProtocolUrl) protocolCallbacks.route(initialProtocolUrl);

app.whenReady().then(async () => {
  loadEnvironmentFile(join(process.cwd(), ".env"));
  loadEnvironmentFile(join(app.getPath("userData"), ".env"));
  const rendererServerPromise = process.env.ELECTRON_RENDERER_URL
    ? Promise.resolve(undefined)
    : startRendererServer(join(__dirname, "../renderer"));
  // Keep startup split into small promises: the renderer can paint while SQLite gets ready.
  // better-sqlite3 opens synchronously; deferring it onto a microtask (instead of
  // running it inline here) lets the renderer server's listen() call get scheduled
  // first, and keeps first paint from sitting behind the DB open. Only the DB-backed
  // IPC handlers below actually need to wait on this.
  const databasePromise = Promise.resolve().then(() =>
    openAppDatabase(join(app.getPath("userData"), "anistream.sqlite")),
  );
  aniList = new AniListClient(
    join(app.getPath("userData"), "anilist-session.bin"),
    emitAniListState,
  );
  protocolCallbacks.attach(handleProtocolUrl);
  // Session restoration can include a one-time profile refresh for older session
  // files. Start it immediately, but do not hold the first BrowserWindow paint
  // behind that network request.
  const restorePromise = aniList.restore();
  mangaDex = new MangaDexClient();
  mal = new MalClient();
  mangaBaka = new MangaBakaClient();
  mangaUpdates = new MangaUpdatesClient();
  if (isAnikotoEnabled()) anikoto = new AnikotoClient();
  app.setAsDefaultProtocolClient("anistream");
  rendererServer = await rendererServerPromise;
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? rendererServer?.url;
  if (!rendererUrl) throw new Error("AniStream's renderer origin is unavailable.");
  const trustedRendererOrigin = new URL(rendererUrl).origin;
  configureSessionPermissions(trustedRendererOrigin);

  // Paint the window as soon as its origin is known instead of waiting on the
  // database open below; loadURL() runs in Chromium's own process and can proceed
  // in parallel with the remaining synchronous setup here.
  createWindow(rendererUrl);
  database = await databasePromise;
  mangaTitle = new MangaTitleModule({
    mangaBaka,
    mangaUpdates,
    mangaDex,
    resume: database,
  });

  registerTrustedIpcHandler(trustedRendererOrigin, "app:get-info", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    databaseReady: database?.ready ?? false,
    videoSourceStatus: anikoto ? "configured" : "unavailable",
  }));

  registerTrackerDomain(trustedRendererOrigin, { aniList, database, authRestored: restorePromise });
  registerAnimeDomain(trustedRendererOrigin, { anikoto, mal });
  registerMangaDomain(trustedRendererOrigin, { mangaDex, mangaTitle, aniList, mal });
  registerResumeDomain(trustedRendererOrigin, { database });
  void restorePromise.then(emitAniListState);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(rendererUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database?.close();
  void rendererServer?.close();
});

function isAnikotoEnabled(): boolean {
  const configured = process.env.ANISTREAM_ANIKOTO_ENABLED?.trim().toLocaleLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function configureSessionPermissions(trustedRendererOrigin: string): void {
  const allowedOrigins = new Set([trustedRendererOrigin, "https://megaplay.buzz"]);
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      permission === "fullscreen" && allowedOrigins.has(safeOrigin(requestingOrigin) ?? ""),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const requestingOrigin = safeOrigin(details.requestingUrl);
      callback(
        permission === "fullscreen" &&
          Boolean(requestingOrigin && allowedOrigins.has(requestingOrigin)),
      );
    },
  );
}
