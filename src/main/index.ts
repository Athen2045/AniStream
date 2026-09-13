import { join } from "node:path";
import { windowChromeOptions } from "./window-chrome";
import { app, BrowserWindow, dialog, session, shell } from "electron";
import { AniListClient } from "./anilist";
import { AnikotoClient } from "./anikoto";
import { MalClient } from "./mal";
import { MangaDexClient } from "./mangadex";
import { MangaBakaClient } from "./mangabaka";
import { MangaUpdatesClient } from "./mangaupdates";
import { KitsuClient } from "./kitsu";
import { MangaTitleModule } from "./manga-title";
import { loadEnvironmentFile } from "./config";
import { openAppDatabase, type AppDatabase } from "./database";
import { startRendererServer, type RendererServer } from "./renderer-server";
import { registerTrustedIpcHandler, sendTypedIpcEvent } from "./ipc";
import { registerTrackerDomain } from "./domains/tracker";
import { registerAnimeDomain } from "./domains/anime";
import { registerMangaDomain } from "./domains/manga";
import { registerKitsuDevelopmentDomain } from "./domains/kitsu";
import { registerResumeDomain } from "./domains/resume";
import { registerActivityDomain } from "./domains/activity";
import { registerBackupDomain } from "./domains/backup";
import { registerPersonalDomain } from "./domains/personal";
import { registerDiscoveryDomain } from "./domains/discovery";
import type { AniListAuthState, AppInfo } from "../shared/contracts";
import { ProtocolCallbackRouter } from "./protocol-callback-router";
import { protocolRegistrationArgs } from "./protocol-registration";
import { UpdateChecker } from "./update-check";
import { UpdateLaunch } from "./update-launch";
import { updateTarget } from "./update-release";
import { trackUpdateWindowHealth } from "./update-window-health";
import { startDevTiming } from "./dev-performance";

const finishStartupTiming = startDevTiming("startup:ready-to-show");

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let disposeActivity: (() => void) | undefined;
let disposeDiscovery: (() => void) | undefined;
let aniList: AniListClient | undefined;
let anikoto: AnikotoClient | undefined;
let mangaDex: MangaDexClient | undefined;
let mal: MalClient | undefined;
let mangaBaka: MangaBakaClient | undefined;
let mangaUpdates: MangaUpdatesClient | undefined;
let mangaTitle: MangaTitleModule | undefined;
let kitsu: KitsuClient | undefined;
let rendererServer: RendererServer | undefined;
let updateChecker: UpdateChecker | undefined;
let updateLaunch: UpdateLaunch | undefined;
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
    ...windowChromeOptions(process.platform),
    backgroundColor: "#0a0909",
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

  if (updateLaunch) trackUpdateWindowHealth(mainWindow, updateLaunch);

  mainWindow.once("ready-to-show", () => {
    finishStartupTiming();
    mainWindow?.show();
  });
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

void app
  .whenReady()
  .then(async () => {
    loadEnvironmentFile(join(process.cwd(), ".env"));
    loadEnvironmentFile(join(app.getPath("userData"), ".env"));
    const rendererServerPromise = process.env.ELECTRON_RENDERER_URL
      ? Promise.resolve(undefined)
      : startRendererServer(join(__dirname, "../renderer"));
    // Keep server startup and database opening concurrent, but wait for both before
    // exposing a BrowserWindow. That gives the renderer one trustworthy IPC boundary.
    const databasePromise = Promise.resolve().then(() =>
      openAppDatabase(join(app.getPath("userData"), "anistream.sqlite")),
    );
    aniList = new AniListClient(
      join(app.getPath("userData"), "anilist-session.bin"),
      emitAniListState,
    );
    protocolCallbacks.attach(handleProtocolUrl);
    // Session restoration may refresh an older session once, but it is intentionally
    // not on the critical path for opening the shell.
    const restorePromise = aniList.restore();
    mangaDex = new MangaDexClient();
    mal = new MalClient();
    mangaBaka = new MangaBakaClient();
    mangaUpdates = new MangaUpdatesClient();
    if (!app.isPackaged) kitsu = new KitsuClient();
    if (isAnikotoEnabled()) anikoto = new AnikotoClient();
    const [protocolExecutable, protocolArgs] = protocolRegistrationArgs({
      platform: process.platform,
      packaged: app.isPackaged,
      execPath: process.execPath,
      entryPath: process.argv[1] ?? join(__dirname, "index.js"),
    });
    if (protocolExecutable && protocolArgs) {
      app.setAsDefaultProtocolClient("anistream", protocolExecutable, protocolArgs);
    } else {
      app.setAsDefaultProtocolClient("anistream");
    }
    rendererServer = await rendererServerPromise;
    const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? rendererServer?.url;
    if (!rendererUrl) throw new Error("AniStream's renderer origin is unavailable.");
    const trustedRendererOrigin = new URL(rendererUrl).origin;
    configureSessionPermissions(trustedRendererOrigin);

    database = await databasePromise;
    const target = updateTarget(app.isPackaged, process.platform, process.arch);
    updateLaunch = new UpdateLaunch(database.updateLaunch, app.getVersion(), target !== undefined);
    updateChecker = new UpdateChecker({
      currentVersion: app.getVersion(),
      target,
      recovery: updateLaunch.recovery,
      onChange: (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
          sendTypedIpcEvent(mainWindow.webContents, "app:update-status-changed", state);
      },
    });
    const checker = updateChecker;
    registerTrustedIpcHandler(trustedRendererOrigin, "app:update-status", () =>
      checker.getStatus(),
    );
    registerTrustedIpcHandler(trustedRendererOrigin, "app:check-updates", () => checker.check());
    mangaTitle = new MangaTitleModule({
      mangaBaka,
      mangaUpdates,
      mangaDex,
      resume: database,
      preferences: database,
    });

    registerTrustedIpcHandler(trustedRendererOrigin, "app:get-info", (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      databaseReady: database?.ready ?? false,
      videoSourceStatus: anikoto ? "configured" : "unavailable",
    }));

    registerTrackerDomain(trustedRendererOrigin, {
      aniList,
      database,
    });
    registerAnimeDomain(trustedRendererOrigin, { anikoto, mal });
    registerMangaDomain(trustedRendererOrigin, {
      readerSettings: database,
      mangaDex,
      mangaTitle,
      aniList,
      mal,
      preferences: database,
    });
    registerResumeDomain(trustedRendererOrigin, { database });
    disposeActivity = registerActivityDomain(trustedRendererOrigin, database, aniList, () => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
    });
    registerPersonalDomain(trustedRendererOrigin, database, aniList);
    registerBackupDomain(trustedRendererOrigin, database.backup, () => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
    });
    if (kitsu) registerKitsuDevelopmentDomain(trustedRendererOrigin, kitsu);
    disposeDiscovery = registerDiscoveryDomain(trustedRendererOrigin, database, aniList);

    // Register every IPC handler before the renderer can invoke the preload bridge.
    // The database still opens off the initial event-loop tick, but a slow disk or
    // migration can no longer expose a half-initialized window.
    createWindow(rendererUrl);
    void checker.check();
    void restorePromise.then(emitAniListState);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(rendererUrl);
    });
  })
  .catch(handleStartupFailure);

function handleStartupFailure(error: unknown): void {
  // Keep this boring on purpose: a half-open shell is much harder to diagnose than a clean stop.
  // TODO: Add a small crash-log export once the app has a user-facing diagnostics surface.
  console.error("AniStream failed during startup.", error);
  if (app.isReady()) {
    dialog.showErrorBox(
      "AniStream could not start",
      "AniStream could not finish opening its local database or renderer. Close the app and try again. If the problem continues, check the application logs.",
    );
  }
  app.quit();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  updateChecker?.dispose();
  updateLaunch?.dispose();
  disposeDiscovery?.();
  disposeActivity?.();
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
