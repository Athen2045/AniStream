/**
 * Offline anime downloads (user decision 2026-10-18): episodes from the own-player source are saved
 * to the user's Downloads folder as the stream's own HLS segments, still encrypted, with their keys
 * and a local playlist. AniStream's player decrypts them at playback exactly as when streaming;
 * AniStream never writes decrypted video. Manga chapters (2026-10-28) are saved as their page
 * images; both share the folder and storage limit.
 */
export type DownloadQuality = "1080p" | "720p" | "360p";
export type DownloadStatus = "queued" | "downloading" | "paused" | "done" | "failed";

export interface AnimeDownload {
  id: string;
  aniListId: number;
  episode: number;
  /** Series title snapshot, for the Downloads page offline. */
  title: string;
  coverUrl?: string;
  quality: DownloadQuality;
  status: DownloadStatus;
  /** Bytes written so far. */
  bytesDone: number;
  /** Estimate until the stream is resolved, then the planned size. */
  bytesExpected: number;
  segmentsDone: number;
  segmentsTotal: number;
  /** Audio languages kept (e.g. `ja`, `en`). */
  audio: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadSettings {
  /** Absolute folder; downloads live in per-title subfolders under it. */
  folder: string;
  limitBytes: number;
  quality: DownloadQuality;
}

/**
 * An offline manga chapter (user decision 2026-10-28): page images saved exactly as served, at
 * original quality, read back by the same reader. MangaDex chapters and chapter-mirror chapters.
 */
export interface MangaChapterDownload {
  id: string;
  aniListId: number;
  /** Series title snapshot, for the Downloads page offline. */
  title: string;
  coverUrl?: string;
  chapter: DownloadedChapterInfo;
  status: DownloadStatus;
  pagesDone: number;
  /** 0 until the first page tells how many there are. */
  pagesTotal: number;
  bytesDone: number;
  /** Estimate until pages arrive, then projected from them. */
  bytesExpected: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the reader and Downloads page need about a downloaded chapter. */
export interface DownloadedChapterInfo {
  source: MangaChapterSource;
  /** The chapter's id in its source (MangaDex chapter UUID or mirror chapter id). */
  id: string;
  number?: number;
  volume?: string;
  chapterTitle?: string;
  translatedLanguage: string;
  /** Scanlation groups, kept for the credit line MangaDex requires. */
  groups: { id: string; name: string }[];
  /** Display credit for a mirror chapter. */
  sourceLabel?: string;
}

export type MangaChapterSource = "mangadex" | "mirror";

export interface DownloadChapterRequest {
  aniListId: number;
  title: string;
  coverUrl?: string;
  chapter: DownloadedChapterInfo;
}

export interface DownloadedChapterPageInput {
  id: string;
  page: number;
}

export interface DownloadsState {
  items: AnimeDownload[];
  /** Manga chapters, in the order they were added. */
  chapters: MangaChapterDownload[];
  settings: DownloadSettings;
  /** Bytes held by downloads (finished and partial). */
  usedBytes: number;
  /** Free space on the folder's drive, when it could be read. */
  freeBytes?: number;
}

export interface DownloadEpisodeRequest {
  aniListId: number;
  episode: number;
  title: string;
  coverUrl?: string;
  /** Episode length in minutes (AniList), for the size estimate; 24 when unknown. */
  minutes?: number;
}

export type DownloadChange =
  | { op: "add"; episodes: DownloadEpisodeRequest[] }
  | { op: "pause" | "resume" | "retry" | "remove"; id: string }
  | { op: "settings"; limitBytes?: number; quality?: DownloadQuality };

export interface DownloadAddResult {
  state: DownloadsState;
  added: number;
  /** Episodes already downloaded or queued. */
  skipped: number;
  /** Set when nothing (or not everything) could be added, e.g. the storage limit. */
  message?: string;
}

const GB = 1024 ** 3;
export const DEFAULT_DOWNLOAD_LIMIT_BYTES = 25 * GB;
export const DOWNLOAD_LIMIT_CHOICES = [10, 25, 50, 100, 250].map((gb) => gb * GB);
export const MIN_DOWNLOAD_LIMIT_BYTES = 1 * GB;
export const MAX_DOWNLOAD_LIMIT_BYTES = 2048 * GB;
export const DOWNLOAD_QUALITIES: readonly DownloadQuality[] = ["1080p", "720p", "360p"];
/** One request adds at most a long season; bigger batches go in parts. */
export const MAX_DOWNLOAD_BATCH = 200;

/**
 * Size per minute of finished downloads, the highest measured on 2026-10-27 (Frieren, Cyberpunk:
 * Edgerunners, Jujutsu Kaisen; Japanese and English audio kept). Shows differ a lot at 720p and
 * 1080p (Frieren's 1080p was 1.5x the others), so this is an upper estimate for before a download
 * starts; its own segments then give the real size. The stream's advertised BANDWIDTH is a peak
 * and overstated real sizes by 20-100%.
 */
export const QUALITY_BYTES_PER_MINUTE: Record<DownloadQuality, number> = {
  "1080p": 20.5 * 1024 ** 2,
  "720p": 12.1 * 1024 ** 2,
  "360p": 5.8 * 1024 ** 2,
};
/** Episodes often run past AniList's length (Frieren lists 24 minutes and runs 26). */
const LENGTH_MARGIN = 1.1;

/** Estimated bytes (an upper estimate) for an episode of `minutes` at `quality`. */
export function estimateDownloadBytes(minutes: number, quality: DownloadQuality): number {
  return Math.round(Math.max(1, minutes) * QUALITY_BYTES_PER_MINUTE[quality] * LENGTH_MARGIN);
}

/** Segments of an episode to fetch before its own average size replaces the estimate. */
export const SIZE_SAMPLE_SEGMENTS = 8;

/**
 * The episode's size from what has been fetched: the average file so far times the number of
 * files, once enough are in (files are fetched with video and audio interleaved, so the average
 * covers both). Before that, `fallback`.
 */
export function projectDownloadBytes(
  bytesDone: number,
  filesDone: number,
  filesTotal: number,
  fallback: number,
): number {
  if (filesDone < Math.min(SIZE_SAMPLE_SEGMENTS, filesTotal) || filesDone === 0) return fallback;
  return Math.max(bytesDone, Math.round((bytesDone / filesDone) * filesTotal));
}

/** "1.4 GB", "620 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 100 * GB ? 0 : 1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function downloadKey(aniListId: number, episode: number): string {
  return `${aniListId}:${episode}`;
}

export function chapterDownloadKey(source: MangaChapterSource, chapterId: string): string {
  return `${source}:${chapterId}`;
}

/**
 * Rough size of a chapter before its pages arrive: about 20 pages of original-quality scans at
 * ~400 KB. An application estimate for the storage limit, replaced by the real size as pages land.
 */
export const CHAPTER_ESTIMATE_BYTES = 8 * 1024 ** 2;
export const MAX_CHAPTER_BATCH = 500;
const CHAPTER_ID = /^[A-Za-z0-9_-]{1,80}$/;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/** Validates chapters to download from the renderer; undefined when anything is malformed. */
export function parseChapterRequests(value: unknown): DownloadChapterRequest[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CHAPTER_BATCH) return undefined;
  const requests: DownloadChapterRequest[] = [];
  for (const item of value) {
    const row = record(item);
    const chapter = record(row?.chapter);
    const aniListId = positiveInt(row?.aniListId, 2_147_483_647);
    const title = text(row?.title, 300);
    const source =
      chapter?.source === "mangadex" || chapter?.source === "mirror" ? chapter.source : undefined;
    const id =
      typeof chapter?.id === "string" && CHAPTER_ID.test(chapter.id) ? chapter.id : undefined;
    const language = text(chapter?.translatedLanguage, 16);
    if (!aniListId || !title || !source || !id || !language || !Array.isArray(chapter?.groups))
      return undefined;
    const number =
      typeof chapter.number === "number" && Number.isFinite(chapter.number) && chapter.number >= 0
        ? chapter.number
        : undefined;
    const groups: { id: string; name: string }[] = [];
    for (const group of chapter.groups.slice(0, 10)) {
      const entry = record(group);
      const groupId = text(entry?.id, 80);
      const name = text(entry?.name, 200);
      if (!groupId || !name) return undefined;
      groups.push({ id: groupId, name });
    }
    const coverUrl =
      typeof row?.coverUrl === "string" && /^https:\/\//.test(row.coverUrl)
        ? row.coverUrl.slice(0, 1_000)
        : undefined;
    const volume = text(chapter.volume, 20);
    const chapterTitle = text(chapter.chapterTitle, 300);
    const sourceLabel = text(chapter.sourceLabel, 80);
    requests.push({
      aniListId,
      title,
      ...(coverUrl ? { coverUrl } : {}),
      chapter: {
        source,
        id,
        ...(number !== undefined ? { number } : {}),
        ...(volume ? { volume } : {}),
        ...(chapterTitle ? { chapterTitle } : {}),
        translatedLanguage: language,
        groups,
        ...(sourceLabel ? { sourceLabel } : {}),
      },
    });
  }
  return requests;
}

export function parseDownloadedChapterPage(value: unknown): DownloadedChapterPageInput | undefined {
  const raw = record(value);
  const id = typeof raw?.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : "";
  const page = raw?.page;
  return id && typeof page === "number" && Number.isInteger(page) && page >= 0 && page < 1_000
    ? { id, page }
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveInt(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : undefined;
}

/** Validates a change from the renderer; undefined when anything is malformed. */
export function parseDownloadChange(value: unknown): DownloadChange | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  switch (raw.op) {
    case "add": {
      if (!Array.isArray(raw.episodes) || !raw.episodes.length) return undefined;
      if (raw.episodes.length > MAX_DOWNLOAD_BATCH) return undefined;
      const episodes: DownloadEpisodeRequest[] = [];
      for (const item of raw.episodes) {
        const row = record(item);
        const aniListId = positiveInt(row?.aniListId, 2_147_483_647);
        const episode = positiveInt(row?.episode, 100_000);
        const title = typeof row?.title === "string" ? row.title.trim() : "";
        if (!aniListId || !episode || !title || title.length > 300) return undefined;
        const coverUrl =
          typeof row?.coverUrl === "string" && /^https:\/\//.test(row.coverUrl)
            ? row.coverUrl.slice(0, 1_000)
            : undefined;
        const minutes = positiveInt(row?.minutes, 600);
        episodes.push({
          aniListId,
          episode,
          title,
          ...(coverUrl ? { coverUrl } : {}),
          ...(minutes ? { minutes } : {}),
        });
      }
      return { op: "add", episodes };
    }
    case "pause":
    case "resume":
    case "retry":
    case "remove": {
      const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : "";
      return id ? { op: raw.op, id } : undefined;
    }
    case "settings": {
      const limitBytes =
        raw.limitBytes === undefined
          ? undefined
          : typeof raw.limitBytes === "number" &&
              Number.isInteger(raw.limitBytes) &&
              raw.limitBytes >= MIN_DOWNLOAD_LIMIT_BYTES &&
              raw.limitBytes <= MAX_DOWNLOAD_LIMIT_BYTES
            ? raw.limitBytes
            : null;
      const quality =
        raw.quality === undefined
          ? undefined
          : DOWNLOAD_QUALITIES.includes(raw.quality as DownloadQuality)
            ? (raw.quality as DownloadQuality)
            : null;
      if (limitBytes === null || quality === null) return undefined;
      if (limitBytes === undefined && quality === undefined) return undefined;
      return {
        op: "settings",
        ...(limitBytes !== undefined ? { limitBytes } : {}),
        ...(quality ? { quality } : {}),
      };
    }
    default:
      return undefined;
  }
}
