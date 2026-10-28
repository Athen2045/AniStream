import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnimeDirectSubtitle } from "../../shared/contracts";
import {
  downloadKey,
  estimateDownloadBytes,
  formatBytes,
  projectDownloadBytes,
  type AnimeDownload,
  type DownloadAddResult,
  type DownloadChange,
  type DownloadEpisodeRequest,
  type DownloadsState,
  type MangaChapterDownload,
} from "../../shared/downloads";
import { PROVIDER_USER_AGENT } from "../provider-transport";
import { createPublicFetch, UnsafeUrlError, type HostLookup } from "../public-fetch";
import type { DownloadStore, StoredDownload } from "./download-store";
import {
  chooseAudio,
  chooseVariant,
  localMasterPlaylist,
  parseMasterPlaylist,
  planMediaPlaylist,
  type PlannedFile,
  type PlannedPlaylist,
} from "./hls-download-plan";

/** Everything needed to fetch one episode: the stream plus its subtitles and fonts. */
export interface DownloadSource {
  src: string;
  headers: Record<string, string>;
  subtitles: { label: string; language: string; default: boolean; url: string }[];
  fonts: string[];
  /** Subtitle text in the player's format (ASS kept, else WebVTT). */
  subtitle(url: string): Promise<AnimeDirectSubtitle>;
}

export interface DownloadManagerDeps {
  store: DownloadStore;
  defaultFolder: string;
  /** Resolves an episode in the direct source (same exact-match rules as playback). */
  resolve(aniListId: number, episode: number): Promise<DownloadSource>;
  fetcher?: typeof fetch;
  /** Resolves a host's addresses so private-network hosts are refused (default: system DNS). */
  lookup?: HostLookup;
  /**
   * Whether the device has a connection (Electron's `net.isOnline()`). A download cut off while
   * offline waits in the queue and continues by itself once back online. Default: always online.
   */
  isOnline?: () => boolean;
  /** How often to look for the connection again while waiting (ms). */
  onlinePollMs?: number;
  /** Called (throttled) whenever the state the renderer shows changes. */
  onChange(): void;
  /**
   * Manga chapter downloads, which share the folder and storage limit: their rows for the state,
   * bytes on disk, and bytes held or still expected.
   */
  manga?: () => { chapters: MangaChapterDownload[]; held: number; committed: number };
}

/** What the player needs to play a finished download. */
export interface OfflineEpisode {
  id: string;
  master: string;
  subtitles: {
    label: string;
    language: string;
    default: boolean;
    format: "ass" | "vtt";
    file: string;
  }[];
  fonts: string[];
}

interface EpisodeManifest extends Omit<OfflineEpisode, "id"> {
  version: 1;
  aniListId: number;
  episode: number;
  title: string;
  quality: string;
  durationSeconds: number;
  savedAt: string;
}

const MANIFEST_FILE = "episode.json";
export const WAITING_FOR_CONNECTION = "Waiting for a connection";
/**
 * Segments fetched at once. Measured 2026-10-27 (720p, same connection): 4 at a time gave
 * 1.6 MiB/s, 8 gave 2.0 MiB/s, the video host's apparent ceiling. 6 is Chromium's connection cap
 * per host, so it keeps that gain without queueing more requests on the host.
 */
const SEGMENT_CONCURRENCY = 6;
const FILE_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
/** Free disk kept beyond a download's size, so the system never runs dry. */
const DISK_MARGIN_BYTES = 1024 ** 3;
const PROGRESS_SAVE_MS = 1_000;
const MAX_FILE_BYTES = 200 * 1024 ** 2;

class RefusedError extends Error {}
class CancelledError extends Error {}

/**
 * Offline anime downloads, one episode at a time. Segments are saved exactly as served (still
 * encrypted) beside their keys and local playlists; nothing here decrypts. Partial episodes
 * resume: finished files are kept and skipped. 403/429 stops the episode instead of retrying.
 */
export class DownloadManager {
  private readonly fetchPublic: ReturnType<typeof createPublicFetch>;
  private active?: { id: string; controller: AbortController };
  private running = false;
  private disposed = false;
  private lastSave = 0;

  public constructor(private readonly deps: DownloadManagerDeps) {
    this.fetchPublic = createPublicFetch({ fetcher: deps.fetcher ?? fetch, lookup: deps.lookup });
  }

  /** Picks up downloads interrupted by a quit or crash. */
  public start(): void {
    for (const item of this.deps.store.list())
      if (item.status === "downloading")
        this.deps.store.update(item.id, { status: "queued", updatedAt: now() });
    void this.run();
  }

  /** Downloads queued or in progress (what running in the background would keep going). */
  public activeCount(): number {
    return this.deps.store
      .list()
      .filter((item) => item.status === "queued" || item.status === "downloading").length;
  }

  public failedCount(): number {
    return this.deps.store.list().filter((item) => item.status === "failed").length;
  }

  public async state(): Promise<DownloadsState> {
    const settings = this.deps.store.getSettings(this.deps.defaultFolder);
    const items = this.deps.store.list();
    const manga = this.deps.manga?.();
    return {
      items: items.map(publicItem),
      chapters: manga?.chapters ?? [],
      settings,
      usedBytes: items.reduce((sum, item) => sum + item.bytesDone, 0) + (manga?.held ?? 0),
      ...(await freeBytes(settings.folder)),
    };
  }

  public async add(requests: DownloadEpisodeRequest[]): Promise<DownloadAddResult> {
    const settings = this.deps.store.getSettings(this.deps.defaultFolder);
    const items = this.deps.store.list();
    // What downloads already hold plus what queued ones still expect to need.
    let committed =
      items.reduce(
        (sum, item) =>
          sum + Math.max(item.bytesDone, item.status === "done" ? 0 : item.bytesExpected),
        0,
      ) + (this.deps.manga?.().committed ?? 0);
    const known = new Set(items.map((item) => downloadKey(item.aniListId, item.episode)));
    let added = 0;
    let skipped = 0;
    let overLimit = 0;
    for (const request of requests) {
      if (known.has(downloadKey(request.aniListId, request.episode))) {
        skipped += 1;
        continue;
      }
      const expected = estimateDownloadBytes(request.minutes ?? 24, settings.quality);
      if (committed + expected > settings.limitBytes) {
        overLimit += 1;
        continue;
      }
      committed += expected;
      known.add(downloadKey(request.aniListId, request.episode));
      const timestamp = now();
      this.deps.store.insert({
        id: randomUUID(),
        aniListId: request.aniListId,
        episode: request.episode,
        title: request.title,
        ...(request.coverUrl ? { coverUrl: request.coverUrl } : {}),
        quality: settings.quality,
        status: "queued",
        bytesDone: 0,
        bytesExpected: expected,
        segmentsDone: 0,
        segmentsTotal: 0,
        audio: [],
        folder: episodeFolder(settings.folder, request),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      added += 1;
    }
    if (added) void this.run();
    this.deps.onChange();
    const message = overLimit
      ? `${overLimit} ${overLimit === 1 ? "episode does" : "episodes do"} not fit in your ${formatBytes(settings.limitBytes)} download limit. Remove downloads or raise the limit.`
      : undefined;
    return { state: await this.state(), added, skipped, ...(message ? { message } : {}) };
  }

  public async apply(change: Exclude<DownloadChange, { op: "add" }>): Promise<DownloadsState> {
    if (change.op === "settings") {
      const current = this.deps.store.getSettings(this.deps.defaultFolder);
      this.deps.store.saveSettings({
        ...current,
        ...(change.limitBytes ? { limitBytes: change.limitBytes } : {}),
        ...(change.quality ? { quality: change.quality } : {}),
      });
    } else {
      const item = this.deps.store.get(change.id);
      if (!item) throw new Error("That download no longer exists.");
      if (change.op === "pause" && item.status !== "done") {
        this.cancelIfActive(item.id);
        this.deps.store.update(item.id, { status: "paused", updatedAt: now() });
      } else if ((change.op === "resume" || change.op === "retry") && item.status !== "done") {
        this.deps.store.update(item.id, { status: "queued", error: undefined, updatedAt: now() });
        void this.run();
      } else if (change.op === "remove") {
        this.cancelIfActive(item.id);
        this.deps.store.remove(item.id);
        await removeEpisodeFolder(item.folder);
      }
    }
    this.deps.onChange();
    return this.state();
  }

  /** Changes where new downloads go; existing ones stay where they are. */
  public async setFolder(folder: string): Promise<DownloadsState> {
    const resolved = path.resolve(folder);
    await mkdir(resolved, { recursive: true });
    this.deps.store.saveSettings({
      ...this.deps.store.getSettings(this.deps.defaultFolder),
      folder: resolved,
    });
    this.deps.onChange();
    return this.state();
  }

  /** The finished download of an episode, read from its manifest. */
  public async offlineEpisode(
    aniListId: number,
    episode: number,
  ): Promise<OfflineEpisode | undefined> {
    const item = this.deps.store.findEpisode(aniListId, episode);
    if (item?.status !== "done") return undefined;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(item.folder, MANIFEST_FILE), "utf8"),
      ) as EpisodeManifest;
      if (manifest.version !== 1) return undefined;
      return {
        id: item.id,
        master: manifest.master,
        subtitles: manifest.subtitles,
        fonts: manifest.fonts,
      };
    } catch {
      // The files were moved or deleted outside AniStream.
      this.deps.store.update(item.id, {
        status: "failed",
        error: "The downloaded files are missing. Download the episode again.",
        updatedAt: now(),
      });
      this.deps.onChange();
      return undefined;
    }
  }

  /** An absolute file inside a download's folder, or undefined for anything outside it. */
  public filePath(id: string, relative: string): string | undefined {
    const item = this.deps.store.get(id);
    if (!item) return undefined;
    const target = path.resolve(item.folder, relative);
    return target.startsWith(path.resolve(item.folder) + path.sep) ? target : undefined;
  }

  public dispose(): void {
    this.disposed = true;
    this.active?.controller.abort();
  }

  private cancelIfActive(id: string): void {
    if (this.active?.id === id) this.active.controller.abort();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.deps.store.list().find((item) => item.status === "queued");
        if (!next) return;
        if (!(await this.waitForConnection())) return;
        const controller = new AbortController();
        this.active = { id: next.id, controller };
        await this.download(next, controller.signal);
        this.active = undefined;
      }
    } finally {
      this.running = false;
      this.active = undefined;
    }
  }

  /** Waits while the device is offline; false when the manager was disposed meanwhile. */
  private async waitForConnection(): Promise<boolean> {
    const online = this.deps.isOnline ?? (() => true);
    while (!online()) {
      if (this.disposed) return false;
      await new Promise((resolve) => setTimeout(resolve, this.deps.onlinePollMs ?? 5_000));
    }
    return !this.disposed;
  }

  private async download(item: StoredDownload, signal: AbortSignal): Promise<void> {
    const update = (patch: Partial<StoredDownload>, force = false): void => {
      this.deps.store.update(item.id, { ...patch, updatedAt: now() });
      if (force || Date.now() - this.lastSave >= PROGRESS_SAVE_MS) {
        this.lastSave = Date.now();
        this.deps.onChange();
      }
    };
    update({ status: "downloading", error: undefined }, true);
    try {
      const source = await this.deps.resolve(item.aniListId, item.episode);
      const masterText = await this.text(source.src, source.headers, signal);
      const master = parseMasterPlaylist(masterText, source.src);
      const playlists: PlannedPlaylist[] = [];
      let videoAttributes: { variant: ReturnType<typeof chooseVariant> } | undefined;
      const audioFolders: { rendition: ReturnType<typeof chooseAudio>[number]; folder: string }[] =
        [];
      if (master.variants.length) {
        const variant = chooseVariant(master.variants, item.quality);
        videoAttributes = { variant };
        playlists.push(
          planMediaPlaylist(
            await this.text(variant.uri, source.headers, signal),
            variant.uri,
            "video",
          ),
        );
        for (const [index, rendition] of chooseAudio(master, variant).entries()) {
          const folder = `audio-${index + 1}`;
          playlists.push(
            planMediaPlaylist(
              await this.text(rendition.uri!, source.headers, signal),
              rendition.uri!,
              folder,
            ),
          );
          audioFolders.push({ rendition, folder });
        }
      } else {
        // A single media playlist (no master).
        playlists.push(planMediaPlaylist(masterText, source.src, "video"));
      }

      // Video and audio interleaved, so the size projected from the first files covers both.
      const longest = Math.max(...playlists.map((playlist) => playlist.files.length));
      const files = Array.from({ length: longest }, (_, index) =>
        playlists.flatMap((playlist) => playlist.files[index] ?? []),
      ).flat();
      const duration = playlists[0]!.durationSeconds;
      // The variant's BANDWIDTH (a peak, audio included) keeps the room check on the safe side;
      // shown is the lower of it and the queued estimate, until the episode's own files give its
      // real size (the peak overstated measured sizes by 20-100%).
      const peak =
        Math.round((duration * (videoAttributes?.variant.bandwidth ?? 0)) / 8) ||
        item.bytesExpected;
      await this.ensureRoom(item, peak);
      const expected = Math.min(peak, item.bytesExpected) || peak;
      update(
        {
          bytesExpected: expected,
          segmentsTotal: files.length,
          audio: audioFolders.map(({ rendition }) => rendition.language ?? rendition.name),
        },
        true,
      );

      for (const playlist of playlists)
        await mkdir(path.join(item.folder, playlist.folder), { recursive: true });
      let bytesDone = 0;
      let segmentsDone = 0;
      const queue = [...files];
      const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          // Await first: `bytesDone += await …` would read the total before other workers add to it.
          const size = await this.file(item.folder, file, source.headers, signal);
          bytesDone += size;
          segmentsDone += 1;
          update({
            bytesDone,
            segmentsDone,
            bytesExpected: projectDownloadBytes(bytesDone, segmentsDone, files.length, expected),
          });
        }
      };
      await Promise.all(Array.from({ length: SEGMENT_CONCURRENCY }, worker));

      // Subtitles and fonts: small, kept in the player's formats.
      const subtitles: OfflineEpisode["subtitles"] = [];
      if (source.subtitles.length) await mkdir(path.join(item.folder, "subs"), { recursive: true });
      for (const [index, track] of source.subtitles.entries()) {
        try {
          const parsed = await source.subtitle(track.url);
          const file = `subs/${index + 1}.${parsed.format}`;
          await writeFile(path.join(item.folder, file), parsed.text, "utf8");
          subtitles.push({
            label: track.label,
            language: track.language,
            default: track.default,
            format: parsed.format,
            file,
          });
        } catch {
          // A missing subtitle never fails the episode.
        }
      }
      const fonts: string[] = [];
      if (source.fonts.length) await mkdir(path.join(item.folder, "fonts"), { recursive: true });
      for (const [index, url] of source.fonts.entries()) {
        const extension =
          new URL(url).pathname.match(/\.(ttf|otf|woff2?|ttc)$/i)?.[1]?.toLowerCase() ?? "ttf";
        const file = `fonts/f${index + 1}.${extension}`;
        try {
          const size = await this.file(item.folder, { url, path: file }, source.headers, signal);
          bytesDone += size;
          fonts.push(file);
        } catch (reason) {
          if (reason instanceof CancelledError || reason instanceof RefusedError) throw reason;
        }
      }

      // Playlists last: a folder with a manifest is a complete, playable episode.
      for (const playlist of playlists)
        await writeFile(
          path.join(item.folder, playlist.folder, "index.m3u8"),
          playlist.text,
          "utf8",
        );
      const masterFile = "master.m3u8";
      await writeFile(
        path.join(item.folder, masterFile),
        videoAttributes
          ? localMasterPlaylist(videoAttributes.variant, audioFolders, "video")
          : "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo/index.m3u8\n",
        "utf8",
      );
      const manifest: EpisodeManifest = {
        version: 1,
        aniListId: item.aniListId,
        episode: item.episode,
        title: item.title,
        quality: item.quality,
        durationSeconds: Math.round(duration),
        master: masterFile,
        subtitles,
        fonts,
        savedAt: now(),
      };
      await writeFile(
        path.join(item.folder, MANIFEST_FILE),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      update(
        { status: "done", bytesDone, bytesExpected: bytesDone, segmentsDone: files.length },
        true,
      );
    } catch (reason) {
      if (reason instanceof CancelledError || signal.aborted) return;
      // Cut off by a lost connection: back in the queue, keeping the files already saved.
      if (!(reason instanceof RefusedError) && this.deps.isOnline && !this.deps.isOnline()) {
        update({ status: "queued", error: WAITING_FOR_CONNECTION }, true);
        return;
      }
      const message =
        reason instanceof RefusedError
          ? reason.message
          : reason instanceof Error
            ? reason.message
            : "The download failed.";
      update({ status: "failed", error: message }, true);
    }
  }

  private async ensureRoom(item: StoredDownload, expected: number): Promise<void> {
    const settings = this.deps.store.getSettings(this.deps.defaultFolder);
    const others =
      this.deps.store
        .list()
        .filter((other) => other.id !== item.id)
        .reduce((sum, other) => sum + other.bytesDone, 0) + (this.deps.manga?.().held ?? 0);
    if (others + expected > settings.limitBytes)
      throw new Error(
        `This episode (${formatBytes(expected)}) would pass your ${formatBytes(settings.limitBytes)} download limit.`,
      );
    await mkdir(item.folder, { recursive: true });
    const space = await freeBytes(item.folder);
    if (
      space.freeBytes !== undefined &&
      space.freeBytes < expected - item.bytesDone + DISK_MARGIN_BYTES
    )
      throw new Error(`Not enough free disk space: ${formatBytes(space.freeBytes)} left.`);
  }

  private async text(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.request(url, headers, signal);
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error("The playlist is too large.");
    return text;
  }

  /** Fetches one file to disk (skipping it when already there); returns its size. */
  private async file(
    folder: string,
    file: PlannedFile,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<number> {
    const target = path.join(folder, ...file.path.split("/"));
    const existing = await stat(target).catch(() => undefined);
    if (existing?.isFile() && existing.size > 0) return existing.size;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.request(file.url, headers, signal);
        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length) throw new Error("An empty file was returned.");
        if (body.length > MAX_FILE_BYTES) throw new Error("A file was unexpectedly large.");
        const partial = `${target}.part`;
        await writeFile(partial, body);
        await rename(partial, target);
        return body.length;
      } catch (reason) {
        if (reason instanceof RefusedError || reason instanceof CancelledError || signal.aborted)
          throw signal.aborted ? new CancelledError() : reason;
        // Offline: no use retrying now; the episode waits for the connection instead.
        if (attempt >= FILE_ATTEMPTS || this.deps.isOnline?.() === false) throw reason;
        await delay(attempt * 2_000, signal);
      }
    }
  }

  private async request(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Response> {
    if (signal.aborted) throw new CancelledError();
    let response: Response;
    try {
      // Every hop HTTPS to a public host, no cookies (public-fetch.ts).
      ({ response } = await this.fetchPublic(url, {
        headers: { "User-Agent": PROVIDER_USER_AGENT, ...headers },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      }));
    } catch (reason) {
      if (signal.aborted) throw new CancelledError();
      // A redirect off HTTPS or into a private network fails the episode without retries.
      if (reason instanceof UnsafeUrlError) throw new RefusedError(reason.message);
      throw reason instanceof Error ? reason : new Error("The download request failed.");
    }
    if (response.status === 403 || response.status === 429)
      throw new RefusedError(
        `The video host refused the download (${response.status}). Try again later.`,
      );
    if (!response.ok) throw new Error(`The video host returned ${response.status}.`);
    return response;
  }
}

function publicItem(item: StoredDownload): AnimeDownload {
  const { folder: _folder, ...rest } = item;
  return rest;
}

function now(): string {
  return new Date().toISOString();
}

/** `<root>/<Title> (<AniList ID>)/Episode 001`, with characters Windows forbids removed. */
export function episodeFolder(root: string, request: DownloadEpisodeRequest): string {
  return path.join(
    titleFolder(root, request.title, request.aniListId),
    `Episode ${String(request.episode).padStart(3, "0")}`,
  );
}

/** `<root>/<Title> (<AniList ID>)`, shared by a title's episodes and chapters. */
export function titleFolder(root: string, title: string, aniListId: number): string {
  const safeTitle =
    [...title]
      // Characters Windows forbids in names, and control characters, become spaces.
      .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? " " : char))
      .join("")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/, "")
      .trim()
      .slice(0, 80) || "Title";
  return path.join(root, `${safeTitle} (${aniListId})`);
}

/** Deletes an episode folder and, when it was the last one, the title folder. */
async function removeEpisodeFolder(folder: string): Promise<void> {
  // Only AniStream's own "Episode NNN" folders are ever removed.
  if (!/^Episode \d{3,}$/.test(path.basename(folder))) return;
  await rm(folder, { recursive: true, force: true });
  await rmdir(path.dirname(folder)).catch(() => undefined);
}

export async function freeBytes(folder: string): Promise<{ freeBytes?: number }> {
  let probe = path.resolve(folder);
  // statfs needs an existing path; walk up to the nearest one.
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      const stats = await statfs(probe);
      return { freeBytes: stats.bavail * stats.bsize };
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return {};
      probe = parent;
    }
  }
  return {};
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CancelledError());
      },
      { once: true },
    );
  });
}
