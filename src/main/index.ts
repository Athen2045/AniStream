import { join } from "node:path";
import { setCaptionControlsVisible, windowChromeOptions } from "./window-chrome";
import { app, BrowserWindow, dialog, protocol, shell } from "electron";
import { AniListClient } from "./anilist";
import { SkipTimesClient } from "./skip-times";
import { SimklClient } from "./simkl/client";
import { simklSessionFile } from "./simkl/session-file";
import { SimklService } from "./simkl/service";
import { registerSimklDomain } from "./domains/simkl";
import { registerProfileDomain } from "./domains/profile";
import { MangaTitleModule } from "./manga-title";
import { environmentFiles, loadEnvironmentFile } from "./config";
import { BUNDLED_KEYS_FILE, loadBundledKeys } from "./bundled-keys";
import { openAppDatabase, type AppDatabase } from "./database";
import { RENDERER_PORT, startRendererServer, type RendererServer } from "./renderer-server";
import { resolveDevRendererUrl } from "./renderer-origin";
import {
  embeddedPlayerOrigins,
  isDatabaseEnabled,
  loadProviderConfig,
  parseProviderConfig,
  PROVIDER_CONFIG_FILE,
  type ProviderConfig,
} from "./provider-config";
import { DownloadManager } from "./downloads/download-manager";
import { ChapterDownloadManager } from "./downloads/chapter-download-manager";
import { StreamProxy, streamSchemePrivileges } from "./stream-proxy";
import { BackgroundMode } from "./background-mode";
import { DEFAULT_BACKGROUND_PREFERENCES } from "../shared/background";
import { sendTypedIpcEvent } from "./ipc";
import { isExternalLinkUrl } from "./ipc-validation";
import { registerTrackerDomain } from "./domains/tracker";
import { registerAnimeDomain } from "./domains/anime";
import { registerMangaDomain } from "./domains/manga";
import { registerResumeDomain } from "./domains/resume";
import { registerActivityDomain } from "./domains/activity";
import { registerBackupDomain } from "./domains/backup";
import { registerPersonalDomain } from "./domains/personal";
import { registerBingeDomain } from "./domains/binge";
import { registerDiscoveryDomain } from "./domains/discovery";
import { registerMoreDomain } from "./domains/more";
import { MorePlayerFrameUserAgent } from "./more-player-frame-ua";
import type { AniListAuthState } from "../shared/contracts";
import { ProtocolCallbackRouter } from "./protocol-callback-router";
import { protocolRegistrationArgs } from "./protocol-registration";
import { UpdateLaunch } from "./update-launch";
import { UpdateService } from "./update-service";
import { trackUpdateWindowHealth } from "./update-window-health";
import { startDevTiming } from "./dev-performance";
import { installTestMode } from "./test-mode";
import { FieldSnapshots } from "./field-snapshots";
import { prefersEnglishTitles, setPreferEnglishTitles } from "./anilist/title-preference";
import { ARTWORK_SCHEME } from "../shared/artwork";
import { createProviderClients } from "./startup/provider-clients";
import { installArtwork } from "./startup/artwork";
import { safeOrigin, secureSession } from "./startup/session-security";
import { setupUpdates } from "./startup/updates";
import { registerAppHandlers } from "./startup/app-handlers";
import { startDownloads } from "./startup/downloads";

const finishStartupTiming = startDevTiming("startup:ready-to-show");

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let downloadManager: DownloadManager | undefined;
let chapterDownloads: ChapterDownloadManager | undefined;
// Opt-in background mode (user decision 2026-10-27): closing can keep AniStream in the tray.
const background = new BackgroundMode({
  window: () => mainWindow,
  preferences: () => database?.backgroundPreferences.read() ?? DEFAULT_BACKGROUND_PREFERENCES,
  savePreferences: (preferences) => database?.backgroundPreferences.write(preferences),
  activeDownloads: () =>
    (downloadManager?.activeCount() ?? 0) + (chapterDownloads?.activeCount() ?? 0),
  failedDownloads: () =>
    (downloadManager?.failedCount() ?? 0) + (chapterDownloads?.failedCount() ?? 0),
  onHidden: () => {
    if (mainWindow) sendTypedIpcEvent(mainWindow.webContents, "app:window-hidden", undefined);
  },
});
let disposeActivity: (() => void) | undefined;
let disposeDiscovery: (() => void) | undefined;
let aniList: AniListClient | undefined;
const streamProxy = new StreamProxy();
let providerConfig: ProviderConfig = parseProviderConfig({});
let simkl: SimklClient | undefined;
let simklService: SimklService | undefined;
let morePlayerFrameUa: MorePlayerFrameUserAgent | undefined;
let rendererServer: RendererServer | undefined;
let updateService: UpdateService | undefined;
let updateLaunch: UpdateLaunch | undefined;
const protocolCallbacks = new ProtocolCallbackRouter();

// Offline artwork scheme (see src/shared/artwork.ts); must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: ARTWORK_SCHEME, privileges: { standard: true, secure: true } },
  streamSchemePrivileges(),
]);

// Development-only Playwright runs: fixture network and a throwaway profile (see test-mode.ts).
// Before the single-instance lock, which is keyed by the profile folder.
const testMode = installTestMode();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const callbackUrl = commandLine.find((argument) => argument.startsWith("anistream://"));
    if (callbackUrl) protocolCallbacks.route(callbackUrl);
    background.show();
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
  // No frame may open a window. Embedded players request ad pop-ups, often from nested frames or
  // with no referrer, so the opener cannot be told apart reliably; AniStream's own links reach the
  // browser through the trusted `app:open-link` call instead (issue 38).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    const { url, initiator } = event;
    if (safeOrigin(url) === trustedRendererOrigin) return;
    event.preventDefault();
    // A player frame can try to move the whole window to an ad page; only AniStream's own page
    // may send a link to the browser this way.
    if (initiator?.origin === trustedRendererOrigin && isExternalLinkUrl(url))
      void shell.openExternal(url);
  });

  // Player frames get the fullscreen bridge for the window's life; More players that opt in also
  // get the stripped UA or ad stubs while they play.
  const playerOrigins = embeddedPlayerOrigins(providerConfig);
  morePlayerFrameUa =
    playerOrigins.length > 0 ||
    providerConfig.more.media.some((player) => player.stripElectronUserAgent)
      ? new MorePlayerFrameUserAgent(mainWindow.webContents, playerOrigins)
      : undefined;
  void morePlayerFrameUa?.start().catch(() => undefined);
  // Never leave the per-frame override armed, or the window controls hidden, across a reload
  // or renderer crash.
  const resetRendererWindowState = (): void => {
    morePlayerFrameUa?.disarm();
    void morePlayerFrameUa?.start().catch(() => undefined);
    if (mainWindow && !mainWindow.isDestroyed())
      setCaptionControlsVisible(mainWindow, process.platform, true);
  };
  mainWindow.webContents.on("did-start-navigation", ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) resetRendererWindowState();
  });
  mainWindow.webContents.on("render-process-gone", resetRendererWindowState);

  mainWindow.on("close", (event) => background.handleClose(event));
  mainWindow.on("closed", () => {
    morePlayerFrameUa?.dispose();
    morePlayerFrameUa = undefined;
    mainWindow = undefined;
  });
}

function emitAniListState(state: AniListAuthState): void {
  if (mainWindow) sendTypedIpcEvent(mainWindow.webContents, "anilist:auth-changed", state);
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (SimklClient.isCallback(url)) await simkl?.handleCallback(url);
  else if (aniList) await aniList.handleCallback(url);
  else return;
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

// Captured from the launching process before any .env file loads, so a file in the user-data
// folder can never redirect the trusted renderer (and its preload bridge) to another origin.
const launchRendererUrl = process.env.ELECTRON_RENDERER_URL;

const initialProtocolUrl = process.argv.find((argument) => argument.startsWith("anistream://"));
if (initialProtocolUrl) protocolCallbacks.route(initialProtocolUrl);

void app
  .whenReady()
  .then(async () => {
    for (const file of environmentFiles({
      packaged: app.isPackaged,
      cwd: process.cwd(),
      userData: app.getPath("userData"),
    }))
      loadEnvironmentFile(file);
    // Read-only public-data keys shipped with packaged builds; any value above wins.
    if (app.isPackaged) loadBundledKeys(join(process.resourcesPath, BUNDLED_KEYS_FILE));
    // Streaming-source endpoints live only in a gitignored local file (shipped by CI as a
    // packaged resource), never in tracked source.
    providerConfig = loadProviderConfig([
      app.isPackaged
        ? join(process.resourcesPath, PROVIDER_CONFIG_FILE)
        : join(process.cwd(), PROVIDER_CONFIG_FILE),
    ]);
    const devRendererUrl = resolveDevRendererUrl({
      packaged: app.isPackaged,
      value: launchRendererUrl,
    });
    const rendererServerPromise = devRendererUrl
      ? Promise.resolve(undefined)
      : startRendererServer(join(__dirname, "../renderer"), {
          frameOrigins: embeddedPlayerOrigins(providerConfig),
          // A test run never takes the real profile's saved-origin port.
          port: testMode ? 0 : RENDERER_PORT,
          // Fixture images and streams sit on reserved `.example` hosts (never when packaged:
          // installTestMode is off in packaged builds).
          testHosts: testMode,
        });
    // Keep server startup and database opening concurrent, but wait for both before
    // exposing a BrowserWindow. That gives the renderer one trustworthy IPC boundary.
    const databasePromise = Promise.resolve().then(() =>
      openAppDatabase(join(app.getPath("userData"), "anistream.sqlite")),
    );
    aniList = new AniListClient(
      join(app.getPath("userData"), "anilist-session.bin"),
      emitAniListState,
    );
    simkl = new SimklClient({
      appVersion: app.getVersion(),
      storage: simklSessionFile(join(app.getPath("userData"), "simkl-session.bin")),
      openExternal: (url) => shell.openExternal(url),
      emitState: (state) => simklService?.authChanged(state),
    });
    protocolCallbacks.attach(handleProtocolUrl);
    // Session restoration may refresh an older session once, but it is intentionally
    // not on the critical path for opening the shell.
    const restorePromise = aniList.restore();
    const clients = createProviderClients(providerConfig, () => database);
    const { mangaDex, mal, tmdb, mangaMirror, aniZip, animeSource, animeDirect } = clients;
    const [protocolExecutable, protocolArgs] = protocolRegistrationArgs({
      platform: process.platform,
      packaged: app.isPackaged,
      execPath: process.execPath,
      entryPath: process.argv[1] ?? join(__dirname, "index.js"),
      cwd: process.cwd(),
    });
    if (protocolExecutable && protocolArgs) {
      app.setAsDefaultProtocolClient("anistream", protocolExecutable, protocolArgs);
    } else {
      app.setAsDefaultProtocolClient("anistream");
    }
    rendererServer = await rendererServerPromise;
    const rendererUrl = devRendererUrl ?? rendererServer?.url;
    if (!rendererUrl) throw new Error("AniStream's renderer origin is unavailable.");
    const trustedRendererOrigin = new URL(rendererUrl).origin;
    secureSession(providerConfig, trustedRendererOrigin);
    const { episodeArtCache, saveDownloadCovers } = installArtwork({
      userData: app.getPath("userData"),
      database: () => database,
    });
    // Own-player streams: opaque anistream-media:// URLs proxied by this process.
    streamProxy.setAppOrigin(trustedRendererOrigin);
    streamProxy.register();

    const openedDatabase = await databasePromise;
    database = openedDatabase;
    animeDirect?.useMatchStore(openedDatabase.directMatches);
    // Before any AniList request is normalized (English titles by default).
    setPreferEnglishTitles(openedDatabase.titlePreferences.read().english);
    const window = (): BrowserWindow | undefined => mainWindow;
    const updates = setupUpdates(trustedRendererOrigin, {
      database: openedDatabase,
      background,
      window,
    });
    updateLaunch = updates.launch;
    updateService = updates.service;
    registerAppHandlers(trustedRendererOrigin, {
      database: openedDatabase,
      background,
      aniList,
      window,
      videoSourceConfigured: animeSource !== undefined,
    });
    const mangaTitle = new MangaTitleModule({
      mangaBaka: clients.mangaBaka,
      mangaUpdates: clients.mangaUpdates,
      mangaDex,
      resume: openedDatabase,
      preferences: openedDatabase,
      chapterFallback: providerConfig.manga.media.some((entry) => entry.kind === "official-links"),
      mirror: mangaMirror,
    });
    const notifyActivityChanged = (): void => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
    };

    // Saved Trending / For You copies; background refreshes run one at a time after startup.
    const fieldSnapshots = new FieldSnapshots({
      store: () => database?.fieldSnapshots,
      // Each title language keeps its own copies; older unscoped copies (unknown language) are unused.
      keyScope: () => (prefersEnglishTitles() ? "titles-en" : "titles-anilist"),
    });
    registerTrackerDomain(trustedRendererOrigin, {
      aniList,
      database: openedDatabase,
      snapshots: fieldSnapshots,
      onChanged: notifyActivityChanged,
    });
    // One AniSkip client (one rate limit) for the player and for saving downloads' skip times.
    const skipTimes = new SkipTimesClient();
    registerAnimeDomain(trustedRendererOrigin, {
      animeSource,
      copies: openedDatabase.titleCopies,
      skipTimes,
      mal: isDatabaseEnabled(providerConfig, "anime", "mal") ? mal : undefined,
      episodeArt: {
        anizip: aniZip,
        kitsu: clients.kitsu,
        tmdb: { links: openedDatabase.animeTmdbLinks, tmdb, aniList },
      },
    });
    ({ downloadManager, chapterDownloads } = startDownloads(trustedRendererOrigin, {
      database: openedDatabase,
      background,
      window,
      aniList,
      animeDirect,
      aniZip,
      mangaDex,
      mangaMirror,
      skipTimes,
      episodeArtCache,
      saveDownloadCovers,
      streamProxy,
    }));
    registerMoreDomain(trustedRendererOrigin, {
      tmdb,
      database: openedDatabase,
      players: providerConfig.more.media,
      frameUserAgent: () => morePlayerFrameUa,
      tracker: () => simklService,
      snapshots: fieldSnapshots,
      copies: openedDatabase.titleCopies,
    });
    registerMangaDomain(trustedRendererOrigin, {
      readerSettings: openedDatabase,
      mangaDex,
      mangaTitle,
      mangaMirror,
      aniList,
      mal: isDatabaseEnabled(providerConfig, "manga", "mal") ? mal : undefined,
      preferences: openedDatabase,
    });
    registerResumeDomain(trustedRendererOrigin, { database: openedDatabase });
    registerBingeDomain(trustedRendererOrigin, openedDatabase);
    disposeActivity = registerActivityDomain(
      trustedRendererOrigin,
      openedDatabase,
      aniList,
      notifyActivityChanged,
    );
    registerPersonalDomain(trustedRendererOrigin, aniList);
    registerBackupDomain(trustedRendererOrigin, openedDatabase.backup, notifyActivityChanged);
    const simklClient = simkl;
    simklService = new SimklService(
      simklClient,
      openedDatabase.simklLibrary,
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed())
          sendTypedIpcEvent(mainWindow.webContents, "simkl:status-changed", status);
      },
      Date.now,
      openedDatabase.simklCatalog,
    );
    const simklSync = simklService;
    registerSimklDomain(trustedRendererOrigin, simklClient, simklSync);
    registerProfileDomain(trustedRendererOrigin, {
      heroPath: join(app.getPath("userData"), "profile-hero.jpg"),
    });
    disposeDiscovery = registerDiscoveryDomain(
      trustedRendererOrigin,
      openedDatabase,
      aniList,
      tmdb,
      simklSync,
      fieldSnapshots,
      mal,
    );

    // Register every IPC handler before the renderer can invoke the preload bridge.
    // The database still opens off the initial event-loop tick, but a slow disk or
    // migration can no longer expose a half-initialized window.
    createWindow(rendererUrl);
    void updates.checker.check();
    void restorePromise.then(emitAniListState);
    void simklClient.restore().then((state) => {
      simklSync.authChanged(state);
      return simklSync.syncIfStale();
    });

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
  background.markQuitting();
  background.dispose();
  downloadManager?.dispose();
  chapterDownloads?.dispose();
  updateService?.dispose();
  updateLaunch?.dispose();
  disposeDiscovery?.();
  disposeActivity?.();
  database?.close();
  void rendererServer?.close();
});
