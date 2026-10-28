import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MangaDexReaderPage } from "../../shared/contracts";
import {
  CHAPTER_ESTIMATE_BYTES,
  chapterDownloadKey,
  formatBytes,
  type DownloadChapterRequest,
  type DownloadSettings,
  type DownloadedChapterInfo,
  type DownloadedChapterPageInput,
  type MangaChapterDownload,
  type MangaChapterSource,
} from "../../shared/downloads";
import type { ChapterDownloadStore, StoredChapterDownload } from "./chapter-download-store";
import { freeBytes, titleFolder, WAITING_FOR_CONNECTION } from "./download-manager";

/** Where a chapter's pages come from: the same client (and request gates) the reader uses. */
export interface ChapterPageSource {
  /** Display name for messages ("MangaDex", the mirror's label). */
  label: string;
  /** Page `index` (0-based) at original quality; also says how many pages the chapter has. */
  page(chapterId: string, index: number): Promise<MangaDexReaderPage>;
  /** A 403/429 from this source: its queue stops instead of retrying. */
  isRefusal(error: unknown): boolean;
  /** Pause after every page (slow pacing for scraped sources). */
  pageDelayMs: number;
}

export interface ChapterDownloadManagerDeps {
  store: ChapterDownloadStore;
  /** Folder and storage limit, shared with anime downloads. */
  settings(): DownloadSettings;
  /** Anime downloads' bytes on disk and bytes they still commit to, for the shared limit. */
  otherBytes(): { held: number; committed: number };
  sources: Partial<Record<MangaChapterSource, ChapterPageSource>>;
  isOnline?: () => boolean;
  onlinePollMs?: number;
  onChange(): void;
}

export interface ChapterAddResult {
  added: number;
  skipped: number;
  overLimit: number;
}

interface ChapterManifest {
  version: 1;
  aniListId: number;
  title: string;
  chapter: DownloadedChapterInfo;
  pages: { file: string; mimeType: string }[];
  savedAt: string;
}

const MANIFEST_FILE = "chapter.json";
const PAGE_ATTEMPTS = 3;
const MAX_PAGES = 1_000;
/** Free disk kept beyond a chapter's size. */
const DISK_MARGIN_BYTES = 512 * 1024 ** 2;
const PROGRESS_SAVE_MS = 1_000;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const MIME_TYPES = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]),
);
const PAGE_FILE = /^(\d{3,4})\.(jpg|png|webp|gif|avif)$/;
const CHAPTER_FOLDER = /^Chapter [\w.]+ \([dm]-[A-Za-z0-9_-]{1,8}\)$/;

class RefusedError extends Error {}
class CancelledError extends Error {}

/**
 * Offline manga chapters (user decision 2026-10-28), one chapter and one page at a time through
 * the reader's own clients, so MangaDex@Home reporting and every request gate still apply. Pages
 * are saved exactly as served. A refusal (403/429) fails the chapter and pauses the rest of that
 * source's queue; partial chapters resume from the pages already saved.
 */
export class ChapterDownloadManager {
  private active?: { id: string; controller: AbortController };
  private running = false;
  private disposed = false;
  private lastSave = 0;

  public constructor(private readonly deps: ChapterDownloadManagerDeps) {}

  public start(): void {
    for (const item of this.deps.store.list())
      if (item.status === "downloading")
        this.deps.store.update(item.id, { status: "queued", updatedAt: now() });
    void this.run();
  }

  public list(): MangaChapterDownload[] {
    return this.deps.store.list().map(publicItem);
  }

  public has(id: string): boolean {
    return Boolean(this.deps.store.get(id));
  }

  public activeCount(): number {
    return this.deps.store
      .list()
      .filter((item) => item.status === "queued" || item.status === "downloading").length;
  }

  public failedCount(): number {
    return this.deps.store.list().filter((item) => item.status === "failed").length;
  }

  /** Bytes on disk, and bytes held or still expected (for the shared limit). */
  public bytes(): { held: number; committed: number } {
    let held = 0;
    let committed = 0;
    for (const item of this.deps.store.list()) {
      held += item.bytesDone;
      committed += Math.max(item.bytesDone, item.status === "done" ? 0 : item.bytesExpected);
    }
    return { held, committed };
  }

  public add(requests: DownloadChapterRequest[]): ChapterAddResult {
    const settings = this.deps.settings();
    let committed = this.bytes().committed + this.deps.otherBytes().committed;
    let added = 0;
    let skipped = 0;
    let overLimit = 0;
    const seen = new Set<string>();
    for (const request of requests) {
      const key = chapterDownloadKey(request.chapter.source, request.chapter.id);
      if (
        seen.has(key) ||
        !this.deps.sources[request.chapter.source] ||
        this.deps.store.find(request.chapter.source, request.chapter.id)
      ) {
        skipped += 1;
        continue;
      }
      if (committed + CHAPTER_ESTIMATE_BYTES > settings.limitBytes) {
        overLimit += 1;
        continue;
      }
      seen.add(key);
      committed += CHAPTER_ESTIMATE_BYTES;
      const timestamp = now();
      this.deps.store.insert({
        id: randomUUID(),
        aniListId: request.aniListId,
        title: request.title,
        ...(request.coverUrl ? { coverUrl: request.coverUrl } : {}),
        chapter: request.chapter,
        status: "queued",
        pagesDone: 0,
        pagesTotal: 0,
        bytesDone: 0,
        bytesExpected: CHAPTER_ESTIMATE_BYTES,
        folder: chapterFolder(settings.folder, request),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      added += 1;
    }
    if (added) void this.run();
    this.deps.onChange();
    return { added, skipped, overLimit };
  }

  /** Pause, resume, retry or remove one chapter download. */
  public async apply(op: "pause" | "resume" | "retry" | "remove", id: string): Promise<void> {
    const item = this.deps.store.get(id);
    if (!item) throw new Error("That download no longer exists.");
    if (op === "pause" && item.status !== "done") {
      this.cancelIfActive(id);
      this.deps.store.update(id, { status: "paused", updatedAt: now() });
    } else if ((op === "resume" || op === "retry") && item.status !== "done") {
      this.deps.store.update(id, { status: "queued", error: undefined, updatedAt: now() });
      void this.run();
    } else if (op === "remove") {
      this.cancelIfActive(id);
      this.deps.store.remove(id);
      await removeChapterFolder(item.folder);
    }
    this.deps.onChange();
  }

  /** One page of a finished chapter, read from disk. */
  public async offlinePage(input: DownloadedChapterPageInput): Promise<MangaDexReaderPage> {
    const item = this.deps.store.get(input.id);
    if (item?.status !== "done") throw new Error("This chapter is not downloaded.");
    try {
      const manifest = JSON.parse(
        await readFile(path.join(item.folder, MANIFEST_FILE), "utf8"),
      ) as ChapterManifest;
      const entry = manifest.version === 1 ? manifest.pages[input.page] : undefined;
      if (!entry || !PAGE_FILE.test(entry.file)) throw new Error("This page does not exist.");
      const bytes = await readFile(path.join(item.folder, entry.file));
      return {
        chapterId: item.chapter.id,
        page: input.page,
        pageCount: manifest.pages.length,
        mimeType: entry.mimeType,
        imageBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch {
      // The files were moved or deleted outside AniStream.
      this.deps.store.update(item.id, {
        status: "failed",
        error: "The downloaded pages are missing. Download the chapter again.",
        updatedAt: now(),
      });
      this.deps.onChange();
      throw new Error("The downloaded pages are missing. Download the chapter again.");
    }
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

  private async waitForConnection(): Promise<boolean> {
    const online = this.deps.isOnline ?? (() => true);
    while (!online()) {
      if (this.disposed) return false;
      await new Promise((resolve) => setTimeout(resolve, this.deps.onlinePollMs ?? 5_000));
    }
    return !this.disposed;
  }

  private async download(item: StoredChapterDownload, signal: AbortSignal): Promise<void> {
    const update = (patch: Partial<StoredChapterDownload>, force = false): void => {
      this.deps.store.update(item.id, { ...patch, updatedAt: now() });
      if (force || Date.now() - this.lastSave >= PROGRESS_SAVE_MS) {
        this.lastSave = Date.now();
        this.deps.onChange();
      }
    };
    const source = this.deps.sources[item.chapter.source];
    if (!source) {
      update({ status: "failed", error: "This chapter's source is no longer configured." }, true);
      return;
    }
    update({ status: "downloading", error: undefined }, true);
    try {
      await this.ensureRoom(item);
      await mkdir(item.folder, { recursive: true });
      const saved = await savedPages(item.folder);
      const pages: ChapterManifest["pages"] = [];
      let bytesDone = 0;
      let pageCount = item.pagesTotal || 1;
      for (let index = 0; index < pageCount; index += 1) {
        const existing = saved.get(index);
        if (existing && item.pagesTotal) {
          pages.push(existing.page);
          bytesDone += existing.size;
          continue;
        }
        const page = await this.page(source, item.chapter.id, index, signal);
        if (index === 0) {
          if (!Number.isInteger(page.pageCount) || page.pageCount < 1 || page.pageCount > MAX_PAGES)
            throw new Error(`${source.label} listed no pages for this chapter.`);
          pageCount = page.pageCount;
        }
        const extension = EXTENSIONS[page.mimeType];
        if (!extension) throw new Error(`${source.label} returned an unsupported image.`);
        const file = `${String(index + 1).padStart(3, "0")}.${extension}`;
        const target = path.join(item.folder, file);
        await writeFile(`${target}.part`, Buffer.from(page.imageBytes));
        await rename(`${target}.part`, target);
        pages.push({ file, mimeType: page.mimeType });
        bytesDone += page.imageBytes.byteLength;
        update({
          pagesDone: pages.length,
          pagesTotal: pageCount,
          bytesDone,
          bytesExpected: Math.round((bytesDone / pages.length) * pageCount),
        });
        if (index + 1 < pageCount) await delay(source.pageDelayMs, signal);
      }
      // The manifest last: a folder with one is a complete, readable chapter.
      const manifest: ChapterManifest = {
        version: 1,
        aniListId: item.aniListId,
        title: item.title,
        chapter: item.chapter,
        pages,
        savedAt: now(),
      };
      await writeFile(
        path.join(item.folder, MANIFEST_FILE),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      update(
        {
          status: "done",
          pagesDone: pages.length,
          pagesTotal: pages.length,
          bytesDone,
          bytesExpected: bytesDone,
        },
        true,
      );
    } catch (reason) {
      if (reason instanceof CancelledError || signal.aborted) return;
      if (reason instanceof RefusedError) {
        update({ status: "failed", error: reason.message }, true);
        // Stop asking that source for more: the rest of its queue waits for the person.
        for (const other of this.deps.store.list())
          if (other.status === "queued" && other.chapter.source === item.chapter.source)
            this.deps.store.update(other.id, {
              status: "paused",
              error: `Paused because ${source.label} refused a request. Continue later.`,
              updatedAt: now(),
            });
        this.deps.onChange();
        return;
      }
      if (this.deps.isOnline && !this.deps.isOnline()) {
        update({ status: "queued", error: WAITING_FOR_CONNECTION }, true);
        return;
      }
      update(
        {
          status: "failed",
          error: reason instanceof Error ? reason.message : "The chapter download failed.",
        },
        true,
      );
    }
  }

  private async page(
    source: ChapterPageSource,
    chapterId: string,
    index: number,
    signal: AbortSignal,
  ): Promise<MangaDexReaderPage> {
    for (let attempt = 1; ; attempt += 1) {
      if (signal.aborted) throw new CancelledError();
      try {
        const page = await source.page(chapterId, index);
        if (signal.aborted) throw new CancelledError();
        return page;
      } catch (reason) {
        if (reason instanceof CancelledError) throw reason;
        if (source.isRefusal(reason))
          throw new RefusedError(
            `${source.label} refused the download (stopped to respect its limits). Try again later.`,
          );
        if (attempt >= PAGE_ATTEMPTS || this.deps.isOnline?.() === false) throw reason;
        await delay(attempt * 3_000, signal);
      }
    }
  }

  private async ensureRoom(item: StoredChapterDownload): Promise<void> {
    const settings = this.deps.settings();
    const others =
      this.deps.store
        .list()
        .filter((other) => other.id !== item.id)
        .reduce((sum, other) => sum + other.bytesDone, 0) + this.deps.otherBytes().held;
    if (others + item.bytesExpected > settings.limitBytes)
      throw new Error(
        `This chapter would pass your ${formatBytes(settings.limitBytes)} download limit.`,
      );
    const space = await freeBytes(path.dirname(item.folder));
    if (space.freeBytes !== undefined && space.freeBytes < item.bytesExpected + DISK_MARGIN_BYTES)
      throw new Error(`Not enough free disk space: ${formatBytes(space.freeBytes)} left.`);
  }
}

function publicItem(item: StoredChapterDownload): MangaChapterDownload {
  const { folder: _folder, ...rest } = item;
  return rest;
}

function now(): string {
  return new Date().toISOString();
}

/** `<root>/<Title> (<AniList ID>)/Chapter 0012.5 (d-1a2b3c4d)`; the id keeps group releases apart. */
export function chapterFolder(root: string, request: DownloadChapterRequest): string {
  const { number, source, id } = request.chapter;
  const label =
    number === undefined
      ? "x"
      : `${String(Math.floor(number)).padStart(4, "0")}${Number.isInteger(number) ? "" : String(number).replace(/^\d+/, "")}`;
  const tag = `${source === "mirror" ? "m" : "d"}-${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8)}`;
  return path.join(
    titleFolder(root, request.title, request.aniListId),
    `Chapter ${label} (${tag})`,
  );
}

/** Pages already saved by an interrupted download, by page index. */
async function savedPages(
  folder: string,
): Promise<Map<number, { page: ChapterManifest["pages"][number]; size: number }>> {
  const saved = new Map<number, { page: ChapterManifest["pages"][number]; size: number }>();
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const match = entry.isFile() ? PAGE_FILE.exec(entry.name) : null;
    if (!match) continue;
    const size = (await stat(path.join(folder, entry.name)).catch(() => undefined))?.size;
    if (!size) continue;
    saved.set(Number(match[1]) - 1, {
      page: { file: entry.name, mimeType: MIME_TYPES[match[2]!]! },
      size,
    });
  }
  return saved;
}

/** Deletes a chapter folder and, when it was the last thing in it, the title folder. */
async function removeChapterFolder(folder: string): Promise<void> {
  // Only AniStream's own chapter folders are ever removed.
  if (!CHAPTER_FOLDER.test(path.basename(folder))) return;
  await rm(folder, { recursive: true, force: true });
  await rmdir(path.dirname(folder)).catch(() => undefined);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
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
