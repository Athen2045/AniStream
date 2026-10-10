import { join } from "node:path";
import { setCaptionControlsVisible, windowChromeOptions } from "./window-chrome";
import { app, BrowserWindow, dialog, protocol, session, shell } from "electron";
import { AniListClient } from "./anilist";
import { AnimeSourceClient } from "./anime-source";
import { MalClient } from "./mal";
import { MangaDexClient } from "./mangadex";
import { MangaBakaClient } from "./mangabaka";
import { MalSyncClient } from "./malsync";
import { MangaMirrorClient } from "./manga-mirror";
import { installPlayerScriptFilter } from "./player-script-filter";
import { MangaUpdatesClient } from "./mangaupdates";
import { KitsuClient } from "./kitsu";
import { TmdbClient } from "./tmdb";
import { SimklClient } from "./simkl/client";
import { simklSessionFile } from "./simkl/session-file";
import { SimklService } from "./simkl/service";
import { registerSimklDomain } from "./domains/simkl";
import { registerProfileDomain } from "./domains/profile";
import { MangaTitleModule } from "./manga-title";
import { loadEnvironmentFile } from "./config";
import { BUNDLED_KEYS_FILE, loadBundledKeys } from "./bundled-keys";
import { openAppDatabase, type AppDatabase } from "./database";
import { RENDERER_PORT, startRendererServer, type RendererServer } from "./renderer-server";
import { resolveDevRendererUrl } from "./renderer-origin";
import {
  embeddedPlayerOrigins as configuredPlayerOrigins,
  isDatabaseEnabled,
  loadProviderConfig,
  parseProviderConfig,
  primaryMedia,
  PROVIDER_CONFIG_FILE,
  type MangaChapterMirrorProvider,
  type ProviderConfig,
} from "./provider-config";
import { registerTrustedIpcHandler, sendTypedIpcEvent } from "./ipc";
import { registerTrackerDomain } from "./domains/tracker";
import { registerAnimeDomain } from "./domains/anime";
import { registerMangaDomain } from "./domains/manga";
import { registerKitsuDevelopmentDomain } from "./domains/kitsu";
import { registerResumeDomain } from "./domains/resume";
import { registerActivityDomain } from "./domains/activity";
import { registerBackupDomain } from "./domains/backup";
import { registerPersonalDomain } from "./domains/personal";
import { registerBingeDomain } from "./domains/binge";
import { registerDiscoveryDomain } from "./domains/discovery";
import { registerMoreDomain } from "./domains/more";
import { MorePlayerFrameUserAgent } from "./more-player-frame-ua";
import type { AniListAuthState, AppInfo } from "../shared/contracts";
import { ProtocolCallbackRouter } from "./protocol-callback-router";
import { protocolRegistrationArgs } from "./protocol-registration";
import { UpdateChecker } from "./update-check";
import { UpdateLaunch } from "./update-launch";
import { updateTarget } from "./update-release";
import { WindowsUpdateInstaller, type UpdaterAdapter } from "./update-install";
import { UpdateService } from "./update-service";
import { trackUpdateWindowHealth } from "./update-window-health";
import { startDevTiming } from "./dev-performance";
import { ArtworkCache } from "./artwork-cache";
import { FieldSnapshots } from "./field-snapshots";
import { PROVIDER_USER_AGENT } from "./provider-transport";
import { ARTWORK_SCHEME, artworkSourceFromCacheUrl } from "../shared/artwork";

const finishStartupTiming = startDevTiming("startup:ready-to-show");

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let disposeActivity: (() => void) | undefined;
let disposeDiscovery: (() => void) | undefined;
let aniList: AniListClient | undefined;
let animeSource: AnimeSourceClient | undefined;
let providerConfig: ProviderConfig = parseProviderConfig({});
let mangaDex: MangaDexClient | undefined;
let mal: MalClient | undefined;
let mangaBaka: MangaBakaClient | undefined;
let mangaUpdates: MangaUpdatesClient | undefined;
let mangaTitle: MangaTitleModule | undefined;
let mangaMirror: MangaMirrorClient | undefined;
let kitsu: KitsuClient | undefined;
let tmdb: TmdbClient | undefined;
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
]);

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
    // Anime embeds can request ad/pop-up windows. Keep the playback surface in-app and
    // never hand provider-created windows to the user's external browser.
    const referrerOrigin = safeOrigin(referrer.url);
    if (referrerOrigin && embeddedPlayerOrigins().includes(referrerOrigin))
      return { action: "deny" };
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (safeOrigin(url) === trustedRendererOrigin) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  morePlayerFrameUa = providerConfig.more.media.some((player) => player.stripElectronUserAgent)
    ? new MorePlayerFrameUserAgent(mainWindow.webContents)
    : undefined;
  // Never leave the per-frame override armed, or the window controls hidden, across a reload
  // or renderer crash.
  const resetRendererWindowState = (): void => {
    morePlayerFrameUa?.disarm();
    if (mainWindow && !mainWindow.isDestroyed())
      setCaptionControlsVisible(mainWindow, process.platform, true);
  };
  mainWindow.webContents.on("did-start-navigation", ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) resetRendererWindowState();
  });
  mainWindow.webContents.on("render-process-gone", resetRendererWindowState);

  mainWindow.on("closed", () => {
    morePlayerFrameUa?.disarm();
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
    loadEnvironmentFile(join(process.cwd(), ".env"));
    loadEnvironmentFile(join(app.getPath("userData"), ".env"));
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
          frameOrigins: embeddedPlayerOrigins(),
          port: RENDERER_PORT,
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
    // The database opens concurrently; until it is ready the reader uses MangaDex's default nodes.
    // One MAL-Sync client (and cache) serves the MangaDex mapping hint and the chapter mirror.
    const malSync = new MalSyncClient();
    mangaDex = new MangaDexClient(undefined, undefined, {
      mappingHint: async (aniListId, signal) =>
        (await malSync.getSitePages(aniListId, "Mangadex", signal)).pages.map(
          (page) => page.identifier,
        ),
      forcePort443: () => {
        try {
          return database?.getReaderSettings().standardPortOnly ?? false;
        } catch {
          return false;
        }
      },
      mappingStore: () => database?.mangaDexMappings,
    });
    if (
      isDatabaseEnabled(providerConfig, "anime", "mal") ||
      isDatabaseEnabled(providerConfig, "manga", "mal")
    )
      mal = new MalClient();
    tmdb = new TmdbClient();
    if (isDatabaseEnabled(providerConfig, "manga", "mangabaka")) mangaBaka = new MangaBakaClient();
    // Optional, user-approved chapter mirror; absent unless the local provider config enables it.
    const mirrorConfig = providerConfig.manga.media.find(
      (entry): entry is MangaChapterMirrorProvider => entry.kind === "chapter-mirror",
    );
    if (mirrorConfig) mangaMirror = new MangaMirrorClient(mirrorConfig, { mapping: malSync });
    if (isDatabaseEnabled(providerConfig, "manga", "mangaupdates"))
      mangaUpdates = new MangaUpdatesClient();
    if (!app.isPackaged && isDatabaseEnabled(providerConfig, "anime", "kitsu"))
      kitsu = new KitsuClient();
    // Fallback media providers are parsed and allowed to frame, but only the primary is used yet.
    const animePlayer = primaryMedia(providerConfig.anime);
    if (animePlayer && isAnimeSourceEnabled()) animeSource = new AnimeSourceClient(animePlayer);
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
    configureSessionPermissions(trustedRendererOrigin);
    const artworkCache = new ArtworkCache({
      directory: join(app.getPath("userData"), "artwork-cache"),
      userAgent: PROVIDER_USER_AGENT,
    });
    // Only allowlisted AniList/Kitsu image URLs resolve; the renderer never names a file.
    protocol.handle(ARTWORK_SCHEME, async (request) => {
      const source = artworkSourceFromCacheUrl(request.url);
      const artwork = source ? await artworkCache.get(source) : undefined;
      if (!artwork) return new Response(null, { status: source ? 404 : 400 });
      return new Response(artwork.body, {
        headers: { "Content-Type": artwork.contentType, "Cache-Control": "no-store" },
      });
    });
    installPlayerScriptFilter(session.defaultSession, [
      ...providerConfig.anime.media.map((player) => ({
        origin: player.playerOrigin,
        scriptHosts: player.scriptHosts,
        blockedScriptPaths: player.blockedScriptPaths,
        blockedRequestHosts: player.blockedRequestHosts,
      })),
      ...providerConfig.more.media,
    ]);

    database = await databasePromise;
    const target = updateTarget(app.isPackaged, process.platform, process.arch);
    updateLaunch = new UpdateLaunch(database.updateLaunch, app.getVersion(), target !== undefined);
    // The service is assigned before any check can run, so these callbacks always reach it.
    let service: UpdateService | undefined;
    const checker = new UpdateChecker({
      currentVersion: app.getVersion(),
      target,
      recovery: updateLaunch.recovery,
      onChange: () => service?.handleChange(),
    });
    const updatePreferences = database.updatePreferences;
    // In-app download/install is Windows x64 only; macOS keeps the release link (Squirrel.Mac
    // requires a signed app).
    const installer =
      target === "win-x64"
        ? new WindowsUpdateInstaller({
            factory: createWindowsUpdater,
            installOnQuit: updatePreferences.read().installOnQuit,
            onChange: () => service?.handleChange(),
          })
        : undefined;
    service = new UpdateService({
      checker,
      installer,
      preferences: updatePreferences,
      onChange: (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
          sendTypedIpcEvent(mainWindow.webContents, "app:update-status-changed", state);
      },
    });
    updateService = service;
    const updates = service;
    registerTrustedIpcHandler(trustedRendererOrigin, "app:update-status", () =>
      updates.getStatus(),
    );
    registerTrustedIpcHandler(trustedRendererOrigin, "app:check-updates", () => updates.check());
    registerTrustedIpcHandler(trustedRendererOrigin, "app:download-update", () =>
      updates.download(),
    );
    registerTrustedIpcHandler(trustedRendererOrigin, "app:cancel-update-download", () =>
      updates.cancelDownload(),
    );
    registerTrustedIpcHandler(trustedRendererOrigin, "app:install-update", () => updates.install());
    registerTrustedIpcHandler(trustedRendererOrigin, "app:update-preferences", () =>
      updates.getPreferences(),
    );
    registerTrustedIpcHandler(
      trustedRendererOrigin,
      "app:set-update-preferences",
      (_event, preferences) => updates.setPreferences(preferences),
    );
    mangaTitle = new MangaTitleModule({
      mangaBaka,
      mangaUpdates,
      mangaDex,
      resume: database,
      preferences: database,
      chapterFallback: providerConfig.manga.media.some((entry) => entry.kind === "official-links"),
      mirror: mangaMirror,
    });

    registerTrustedIpcHandler(trustedRendererOrigin, "app:get-info", (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      databaseReady: database?.ready ?? false,
      videoSourceStatus: animeSource ? "configured" : "unavailable",
    }));
    registerTrustedIpcHandler(trustedRendererOrigin, "window:caption-controls", (_, visible) => {
      if (mainWindow && !mainWindow.isDestroyed())
        setCaptionControlsVisible(mainWindow, process.platform, visible);
    });

    // Saved Trending / For You copies; background refreshes run one at a time after startup.
    const fieldSnapshots = new FieldSnapshots({ store: () => database?.fieldSnapshots });
    registerTrackerDomain(trustedRendererOrigin, {
      aniList,
      database,
      snapshots: fieldSnapshots,
      onChanged: () => {
        if (mainWindow && !mainWindow.isDestroyed())
          sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
      },
    });
    registerAnimeDomain(trustedRendererOrigin, {
      animeSource,
      mal: isDatabaseEnabled(providerConfig, "anime", "mal") ? mal : undefined,
      episodeArt: tmdb ? { links: database.animeTmdbLinks, tmdb, aniList } : undefined,
    });
    registerMoreDomain(trustedRendererOrigin, {
      tmdb,
      database,
      players: providerConfig.more.media,
      frameUserAgent: () => morePlayerFrameUa,
      tracker: () => simklService,
      snapshots: fieldSnapshots,
    });
    registerMangaDomain(trustedRendererOrigin, {
      readerSettings: database,
      mangaDex,
      mangaTitle,
      mangaMirror,
      aniList,
      mal: isDatabaseEnabled(providerConfig, "manga", "mal") ? mal : undefined,
      preferences: database,
    });
    registerResumeDomain(trustedRendererOrigin, { database });
    registerBingeDomain(trustedRendererOrigin, database);
    disposeActivity = registerActivityDomain(trustedRendererOrigin, database, aniList, () => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
    });
    registerPersonalDomain(trustedRendererOrigin, aniList);
    registerBackupDomain(trustedRendererOrigin, database.backup, () => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendTypedIpcEvent(mainWindow.webContents, "activity:changed", undefined);
    });
    if (kitsu) registerKitsuDevelopmentDomain(trustedRendererOrigin, kitsu);
    const simklClient = simkl;
    simklService = new SimklService(
      simklClient,
      database.simklLibrary,
      (status) => {
        if (mainWindow && !mainWindow.isDestroyed())
          sendTypedIpcEvent(mainWindow.webContents, "simkl:status-changed", status);
      },
      Date.now,
      database.simklCatalog,
    );
    const simklSync = simklService;
    registerSimklDomain(trustedRendererOrigin, simklClient, simklSync);
    registerProfileDomain(trustedRendererOrigin, {
      heroPath: join(app.getPath("userData"), "profile-hero.jpg"),
      userAgent: PROVIDER_USER_AGENT,
    });
    disposeDiscovery = registerDiscoveryDomain(
      trustedRendererOrigin,
      database,
      aniList,
      tmdb,
      simklSync,
      fieldSnapshots,
    );

    // Register every IPC handler before the renderer can invoke the preload bridge.
    // The database still opens off the initial event-loop tick, but a slow disk or
    // migration can no longer expose a half-initialized window.
    createWindow(rendererUrl);
    void checker.check();
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
  updateService?.dispose();
  updateLaunch?.dispose();
  disposeDiscovery?.();
  disposeActivity?.();
  database?.close();
  void rendererServer?.close();
});

/** electron-updater, loaded only in packaged Windows builds and pinned to one release's assets. */
async function createWindowsUpdater(feedUrl: string) {
  const { NsisUpdater, CancellationToken } = await import("electron-updater");
  const updater = new NsisUpdater({ provider: "generic", url: feedUrl });
  // Keep the console quiet: no per-request info logging, only problems.
  updater.logger = {
    info: () => undefined,
    warn: (message: unknown) => console.warn("AniStream updater:", message),
    error: (message: unknown) => console.error("AniStream updater:", message),
  };
  // NsisUpdater's typed emitter and CancellationToken class are wider than the adapter slice.
  return {
    updater: updater as unknown as UpdaterAdapter,
    createToken: () => new CancellationToken(),
  };
}

function isAnimeSourceEnabled(): boolean {
  const configured = process.env.ANISTREAM_ANIME_SOURCE_ENABLED?.trim().toLocaleLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}

/** Configured third-party player origins the renderer may frame (from providers.local.json). */
function embeddedPlayerOrigins(): string[] {
  return configuredPlayerOrigins(providerConfig);
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
  const allowedOrigins = new Set([trustedRendererOrigin, ...embeddedPlayerOrigins()]);
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
