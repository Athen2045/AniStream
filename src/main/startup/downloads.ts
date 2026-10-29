import { join } from "node:path";
import { app, net, type BrowserWindow } from "electron";
import type { AniListClient } from "../anilist";
import type { AnimeDirectSource } from "../anime-direct-source";
import type { AniZipClient } from "../anizip";
import type { ArtworkCache } from "../artwork-cache";
import type { BackgroundMode } from "../background-mode";
import type { AppDatabase } from "../database";
import { registerAnimeDirectDomain, resolveDirectEpisode } from "../domains/anime-direct";
import { registerDownloadsDomain } from "../domains/downloads";
import { ChapterDownloadManager } from "../downloads/chapter-download-manager";
import { createDownloadExtras, readDownloadPlaylist } from "../downloads/download-extras";
import { DownloadManager } from "../downloads/download-manager";
import { sendTypedIpcEvent } from "../ipc";
import { MirrorRefusedError, type MangaMirrorClient } from "../manga-mirror";
import { isMangaDexRefusal, type MangaDexClient } from "../mangadex";
import { netRequestFetch } from "../net-request-fetch";
import type { SkipTimesClient } from "../skip-times";
import type { StreamProxy } from "../stream-proxy";

/**
 * Pauses between downloaded chapter pages (application policies; neither source publishes a
 * download rate). The scraped mirror is paced slowly, as the user approved on 2026-10-28.
 */
const MANGADEX_DOWNLOAD_PAGE_DELAY_MS = 300;
const MIRROR_DOWNLOAD_PAGE_DELAY_MS = 3_000;

/**
 * Offline downloads: episodes (user decision 2026-10-18, Videos/AniStream/Downloads by default)
 * and manga chapters (2026-10-28, original quality through the reader's own clients), each
 * download's cover, still and skip times saved while online, and the own player's direct-stream
 * IPC that plays them. Both managers are started before returning.
 */
export function startDownloads(
  trustedRendererOrigin: string,
  options: {
    database: AppDatabase;
    background: BackgroundMode;
    window: () => BrowserWindow | undefined;
    aniList: AniListClient;
    animeDirect?: AnimeDirectSource;
    aniZip?: AniZipClient;
    mangaDex?: MangaDexClient;
    mangaMirror?: MangaMirrorClient;
    skipTimes: SkipTimesClient;
    episodeArtCache: ArtworkCache;
    saveDownloadCovers: () => void;
    streamProxy: StreamProxy;
  },
): { downloadManager: DownloadManager; chapterDownloads: ChapterDownloadManager } {
  const { database, background, aniList, animeDirect, aniZip, saveDownloadCovers } = options;
  let downloadManager: DownloadManager | undefined;
  let chapterDownloads: ChapterDownloadManager | undefined;
  let downloadsChangedTimer: ReturnType<typeof setTimeout> | undefined;
  // Each downloaded episode's still and skip times, saved while online (download-extras.ts).
  const downloadExtras = createDownloadExtras({
    downloads: () => database.downloads.list(),
    copies: database.titleCopies,
    stills: options.episodeArtCache,
    skipTimes: options.skipTimes,
    readPlaylist: readDownloadPlaylist((id, relative) => downloadManager?.filePath(id, relative)),
  });
  const downloadsChanged = (): void => {
    background.downloadsChanged();
    saveDownloadCovers();
    downloadExtras.save();
    // Progress arrives often; the renderer re-reads at most a few times a second.
    if (downloadsChangedTimer) return;
    downloadsChangedTimer = setTimeout(() => {
      downloadsChangedTimer = undefined;
      const window = options.window();
      if (window) sendTypedIpcEvent(window.webContents, "downloads:changed", undefined);
    }, 250);
  };
  const downloadsFolder = join(app.getPath("videos"), "AniStream", "Downloads");
  downloadManager = new DownloadManager({
    store: database.downloads,
    defaultFolder: downloadsFolder,
    resolve: async (aniListId, episode) => {
      if (!animeDirect) throw new Error("The backup source is not configured.");
      const { stream } = await resolveDirectEpisode(
        animeDirect,
        aniList,
        aniListId,
        episode,
        aniZip,
      );
      return {
        src: stream.src,
        headers: animeDirect.mediaHeaders(),
        subtitles: stream.subtitles,
        fonts: stream.fonts,
        subtitle: (url) => animeDirect.subtitle(url),
      };
    },
    fetcher: netRequestFetch,
    isOnline: () => net.isOnline(),
    onChange: downloadsChanged,
    manga: () => ({
      chapters: chapterDownloads?.list() ?? [],
      ...(chapterDownloads?.bytes() ?? { held: 0, committed: 0 }),
    }),
  });
  // The mirror is paced slowly (one page every few seconds) on top of its own gates.
  const animeDownloads = database.downloads;
  const dex = options.mangaDex;
  const mirror = options.mangaMirror;
  chapterDownloads = new ChapterDownloadManager({
    store: database.chapterDownloads,
    settings: () => animeDownloads.getSettings(downloadsFolder),
    otherBytes: () => {
      let held = 0;
      let committed = 0;
      for (const item of animeDownloads.list()) {
        held += item.bytesDone;
        committed += Math.max(item.bytesDone, item.status === "done" ? 0 : item.bytesExpected);
      }
      return { held, committed };
    },
    sources: {
      ...(dex
        ? {
            mangadex: {
              label: "MangaDex",
              page: (chapterId, page) => dex.getPage({ chapterId, page, quality: "data" }),
              isRefusal: isMangaDexRefusal,
              pageDelayMs: MANGADEX_DOWNLOAD_PAGE_DELAY_MS,
            },
          }
        : {}),
      ...(mirror
        ? {
            mirror: {
              label: mirror.label,
              page: (chapterId, page) => mirror.getPage({ chapterId, page }),
              isRefusal: (error) => error instanceof MirrorRefusedError,
              pageDelayMs: MIRROR_DOWNLOAD_PAGE_DELAY_MS,
            },
          }
        : {}),
    },
    isOnline: () => net.isOnline(),
    onChange: downloadsChanged,
  });
  const episodes = downloadManager;
  options.streamProxy.setOfflineFiles((id, relative) => episodes.filePath(id, relative));
  registerDownloadsDomain(trustedRendererOrigin, downloadManager, chapterDownloads);
  downloadManager.start();
  chapterDownloads.start();
  saveDownloadCovers();
  downloadExtras.save();
  registerAnimeDirectDomain(trustedRendererOrigin, {
    source: animeDirect,
    proxy: options.streamProxy,
    aniList,
    anizip: aniZip,
    downloads: () => episodes,
  });
  return { downloadManager, chapterDownloads };
}
