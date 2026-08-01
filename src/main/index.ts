import { join } from "node:path";
import { app, BrowserWindow, session, shell } from "electron";
import { AniListClient } from "./anilist";
import { AnikotoClient } from "./anikoto";
import { MalClient } from "./mal";
import { MangaDexClient } from "./mangadex";
import { MangaBakaClient } from "./mangabaka";
import { MangaUpdatesClient } from "./mangaupdates";
import { loadEnvironmentFile } from "./config";
import { openAppDatabase, type AppDatabase } from "./database";
import {
  classifyLatestMangaUpdates,
  needsMalKindCrossCheck,
  type AniListMangaKindHint,
} from "./manga-kind";
import { startRendererServer, type RendererServer } from "./renderer-server";
import { registerTrustedIpcHandler, sendTypedIpcEvent } from "./ipc";
import type {
  AnimeEpisodeCatalogInput,
  AniListAuthState,
  AniListMediaType,
  AppInfo,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexPageInput,
  MangaDexReaderInput,
  MangaPublicationKind,
  AnimePlaybackInput,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";

let database: AppDatabase | undefined;
let mainWindow: BrowserWindow | undefined;
let aniList: AniListClient | undefined;
let anikoto: AnikotoClient | undefined;
let mangaDex: MangaDexClient | undefined;
let mal: MalClient | undefined;
let mangaBaka: MangaBakaClient | undefined;
let mangaUpdates: MangaUpdatesClient | undefined;
let rendererServer: RendererServer | undefined;
let pendingProtocolUrl: string | undefined;

function createWindow(rendererUrl: string): void {
  mainWindow = new BrowserWindow({
    // Standard macOS app default: matches the 1440x900 logical resolution of MacBook
    // displays so the window opens full-feeling without being maximized.
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#090b10",
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  void mainWindow.loadURL(rendererUrl).catch((error: unknown) => {
    console.error("AniStream renderer failed to load.", error);
    mainWindow?.show();
  });

  const trustedRendererOrigin = new URL(rendererUrl).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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

function emitAniListState(state: AniListAuthState): void {
  if (mainWindow) sendTypedIpcEvent(mainWindow.webContents, "anilist:auth-changed", state);
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
  const rendererServerPromise = process.env.ELECTRON_RENDERER_URL
    ? Promise.resolve(undefined)
    : startRendererServer(join(__dirname, "../renderer"));
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

  registerTrustedIpcHandler(trustedRendererOrigin, "app:get-info", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    databaseReady: database?.ready ?? false,
    videoSourceStatus: anikoto ? "configured" : "unavailable",
  }));

  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:auth-state", async () => {
    await restorePromise;
    return aniList?.getState() ?? { status: "signed-out" };
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:login", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.startLogin();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:logout", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.logout();
    database?.clearCachedAniListDashboard();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:cached-dashboard", () =>
    database?.getCachedAniListDashboard(),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:dashboard", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    const dashboard = await aniList.getDashboard();
    database?.saveCachedAniListDashboard(dashboard);
    return dashboard;
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:search",
    async (_event, query: string, type: AniListMediaType) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.searchMedia(query, type);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:browse",
    async (_event, input: BrowseAniListInput) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.browseMedia(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:media-detail",
    async (_event, id: number, type: AniListMediaType) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.getMediaDetail(id, type);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:add-entry",
    async (_event, mediaId: number) => {
      if (!aniList) throw new Error("AniList is not ready.");
      const entry = await aniList.addEntry(mediaId);
      database?.clearCachedAniListDashboard();
      return entry;
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:update-entry",
    async (_event, input: UpdateAniListEntryInput) => {
      if (!aniList) throw new Error("AniList is not ready.");
      const entry = await aniList.updateEntry(input);
      database?.clearCachedAniListDashboard();
      return entry;
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:delete-entry",
    async (_event, id: number) => {
      if (!aniList) throw new Error("AniList is not ready.");
      await aniList.deleteEntry(id);
      database?.clearCachedAniListDashboard();
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:episode-catalog",
    async (_event, input: AnimeEpisodeCatalogInput) => {
      if (!anikoto) {
        return {
          status: "unavailable",
          provider: "anikoto",
          seasons: [],
          message: "Anikoto is disabled in AniStream's local configuration.",
          checkedAt: new Date().toISOString(),
        };
      }
      return anikoto.getEpisodeCatalog(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:latest-anime",
    async (_event, page: number) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.getLatestAnimeUpdates(page);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mal:score",
    async (_event, type: AniListMediaType, malId: number) => {
      if (!mal) throw new Error("MyAnimeList is not ready.");
      return mal.getScore(type, malId);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mal:trending-fallback",
    async (_event, type: AniListMediaType) => {
      if (!mal) throw new Error("MyAnimeList is not ready.");
      return mal.getRanking(type);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mangadex:latest",
    async (_event, page: number) => {
      if (!mangaDex) throw new Error("MangaDex is not ready.");
      const updates = await mangaDex.getLatestUpdates(page);
      let aniListHints = new Map<number, AniListMangaKindHint>();
      if (aniList) {
        try {
          aniListHints = await aniList.getMangaKindHints(
            updates.items.flatMap((item) => (item.aniListId ? [item.aniListId] : [])),
          );
        } catch {
          // Classification enrichment is best-effort; MangaDex language remains usable.
        }
      }

      const malHints = new Map<number, MangaPublicationKind>();
      if (mal?.configured) {
        const malIds = [
          ...new Set(
            updates.items.flatMap((item) => {
              const aniListHint = item.aniListId ? aniListHints.get(item.aniListId) : undefined;
              const malId = item.malId ?? aniListHint?.malId;
              return malId && needsMalKindCrossCheck(item, aniListHint) ? [malId] : [];
            }),
          ),
        ].slice(0, 6);
        await Promise.all(
          malIds.map(async (malId) => {
            const kind = await mal?.getMangaPublicationKind(malId);
            if (kind) malHints.set(malId, kind);
          }),
        );
      }
      return {
        ...updates,
        items: classifyLatestMangaUpdates(updates.items, aniListHints, malHints),
      };
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mangadex:availability",
    async (_event, media: MangaDexAvailabilityInput[]) => {
      if (!mangaDex) throw new Error("MangaDex is not ready.");
      return mangaDex.getAvailability(media);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mangadex:reader",
    async (_event, input: MangaDexReaderInput) => {
      if (!mangaDex) throw new Error("MangaDex is not ready.");
      return mangaDex.getReader(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mangadex:page",
    async (_event, input: MangaDexPageInput) => {
      if (!mangaDex) throw new Error("MangaDex is not ready.");
      return mangaDex.getPage(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:enrichment",
    async (_event, aniListId: number) => {
      if (!mangaBaka) throw new Error("MangaBaka is not ready.");
      const enrichment = await mangaBaka.getEnrichment(aniListId);
      if (enrichment.status !== "available" || !enrichment.mangaUpdatesId || !mangaUpdates) {
        return enrichment;
      }
      const seriesId = Number(enrichment.mangaUpdatesId);
      if (!Number.isInteger(seriesId) || seriesId <= 0) return enrichment;
      try {
        const [series, groups] = await Promise.all([
          mangaUpdates.getSeries(seriesId),
          mangaUpdates.getGroups(seriesId),
        ]);
        return {
          ...enrichment,
          mangaUpdates: { ...series, groups },
        };
      } catch {
        return enrichment;
      }
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:playback",
    async (_event, input: AnimePlaybackInput) => {
      if (!anikoto) throw new Error("Anikoto playback is disabled.");
      return anikoto.getPlayback(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "playback:resume",
    (_event, aniListId: number) => {
      if (!database) throw new Error("AniStream database is not ready.");
      return database.getPlaybackResume(aniListId);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "playback:save-resume",
    (_event, input: SavePlaybackResumeInput) => {
      if (!database) throw new Error("AniStream database is not ready.");
      database.savePlaybackResume(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "playback:clear-resume",
    (_event, aniListId: number) => {
      if (!database) throw new Error("AniStream database is not ready.");
      database.clearPlaybackResume(aniListId);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:reading-resume",
    (_event, aniListId: number) => {
      if (!database) throw new Error("AniStream database is not ready.");
      return database.getMangaReadingResume(aniListId);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:save-reading-resume",
    (_event, input: SaveMangaReadingResumeInput) => {
      if (!database) throw new Error("AniStream database is not ready.");
      database.saveMangaReadingResume(input);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:clear-reading-resume",
    (_event, aniListId: number) => {
      if (!database) throw new Error("AniStream database is not ready.");
      database.clearMangaReadingResume(aniListId);
    },
  );
  void restorePromise.then(emitAniListState);

  if (pendingProtocolUrl) {
    const callbackUrl = pendingProtocolUrl;
    pendingProtocolUrl = undefined;
    void handleProtocolUrl(callbackUrl);
  }

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
