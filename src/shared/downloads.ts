/**
 * Offline anime downloads (user decision 2026-10-18): episodes from the own-player source are saved
 * to the user's Downloads folder as the stream's own HLS segments, still encrypted, with their keys
 * and a local playlist. AniStream's player decrypts them at playback exactly as when streaming;
 * AniStream never writes decrypted video. Anime only for now.
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

export interface DownloadsState {
  items: AnimeDownload[];
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
 * Measured on the source 2026-10-18 (BANDWIDTH of the 360p/720p/1080p variants) plus kept audio;
 * used to estimate a download's size before its stream is resolved.
 */
export const QUALITY_BITS_PER_SECOND: Record<DownloadQuality, number> = {
  "1080p": 3_476_000,
  "720p": 2_376_000,
  "360p": 946_000,
};
export const AUDIO_BITS_PER_SECOND = 128_000;

/** Estimated bytes for an episode of `minutes` at `quality` with `audioTracks` audio renditions. */
export function estimateDownloadBytes(
  minutes: number,
  quality: DownloadQuality,
  audioTracks = 2,
): number {
  const seconds = Math.max(1, minutes) * 60;
  return Math.round(
    (seconds * (QUALITY_BITS_PER_SECOND[quality] + audioTracks * AUDIO_BITS_PER_SECOND)) / 8,
  );
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
