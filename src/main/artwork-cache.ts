import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isCacheableArtworkUrl } from "../shared/artwork";

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
const TYPE_BY_EXTENSION = Object.fromEntries(
  Object.entries(IMAGE_TYPES).map(([type, extension]) => [extension, type]),
);

export interface ArtworkCacheOptions {
  directory: string;
  userAgent: string;
  fetch?: typeof fetch;
  /** Conservative application policy: about 120 titles' cover + banner. */
  maxBytes?: number;
  maxFiles?: number;
  maxImageBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
}

export interface CachedArtwork {
  /** Backed by its own ArrayBuffer, so a Response can serve it without another copy. */
  body: Buffer<ArrayBuffer>;
  contentType: string;
}

/**
 * Bounded on-disk copy of artwork from the allowlisted image hosts. Files are named by a hash of
 * their URL, so the renderer never supplies a path. A hit refreshes the file's time and the
 * least recently used files are evicted once either limit is exceeded.
 */
export class ArtworkCache {
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly maxImageBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly inFlight = new Map<string, Promise<CachedArtwork | undefined>>();
  private ready?: Promise<void>;

  constructor(private readonly options: ArtworkCacheOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? 80 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 400;
    this.maxImageBytes = options.maxImageBytes ?? 8 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
  }

  /** The local copy when present, otherwise a fresh download; undefined when neither works. */
  get(url: string): Promise<CachedArtwork | undefined> {
    if (!isCacheableArtworkUrl(url)) return Promise.resolve(undefined);
    const key = createHash("sha256").update(url).digest("hex");
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.load(key, url).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private async load(key: string, url: string): Promise<CachedArtwork | undefined> {
    await this.ensureDirectory();
    const local = await this.readLocal(key);
    if (local) return local;
    try {
      const response = await this.fetchImpl(url, {
        headers: { "User-Agent": this.options.userAgent, Accept: "image/*" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
      const extension = IMAGE_TYPES[contentType];
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || !extension || declared > this.maxImageBytes) return undefined;
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > this.maxImageBytes) return undefined;
      const file = join(this.options.directory, `${key}.${extension}`);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, body);
      await rename(temporary, file);
      void this.evict().catch(() => undefined);
      return { body, contentType };
    } catch {
      return undefined;
    }
  }

  private async readLocal(key: string): Promise<CachedArtwork | undefined> {
    for (const [extension, contentType] of Object.entries(TYPE_BY_EXTENSION)) {
      const file = join(this.options.directory, `${key}.${extension}`);
      try {
        const body = await readFile(file);
        const now = this.now();
        await utimes(file, now, now).catch(() => undefined);
        return { body, contentType };
      } catch {
        // Not cached with this extension.
      }
    }
    return undefined;
  }

  private ensureDirectory(): Promise<void> {
    this.ready ??= mkdir(this.options.directory, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  async evict(): Promise<void> {
    const names = await readdir(this.options.directory);
    const files = (
      await Promise.all(
        names
          .filter((name) => /^[0-9a-f]{64}\.[a-z]+$/.test(name))
          .map(async (name) => {
            const path = join(this.options.directory, name);
            const info = await stat(path).catch(() => undefined);
            return info ? { path, size: info.size, used: info.mtimeMs } : undefined;
          }),
      )
    )
      .filter((file): file is { path: string; size: number; used: number } => Boolean(file))
      .sort((a, b) => b.used - a.used);
    let bytes = 0;
    for (const [index, file] of files.entries()) {
      bytes += file.size;
      if (index >= this.maxFiles || bytes > this.maxBytes) await rm(file.path, { force: true });
    }
  }
}
