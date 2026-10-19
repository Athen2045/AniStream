import type Database from "better-sqlite3";
import {
  DEFAULT_DOWNLOAD_LIMIT_BYTES,
  DOWNLOAD_QUALITIES,
  MAX_DOWNLOAD_LIMIT_BYTES,
  MIN_DOWNLOAD_LIMIT_BYTES,
  type AnimeDownload,
  type DownloadQuality,
  type DownloadSettings,
  type DownloadStatus,
} from "../../shared/downloads";

/** One download row plus where its files live (relative to the downloads folder). */
export interface StoredDownload extends AnimeDownload {
  folder: string;
}

export interface DownloadStore {
  list(): StoredDownload[];
  get(id: string): StoredDownload | undefined;
  findEpisode(aniListId: number, episode: number): StoredDownload | undefined;
  insert(item: StoredDownload): void;
  update(id: string, patch: Partial<Omit<StoredDownload, "id" | "aniListId" | "episode">>): void;
  remove(id: string): void;
  getSettings(defaultFolder: string): DownloadSettings;
  saveSettings(settings: DownloadSettings): void;
}

interface Row {
  id: string;
  anilist_id: number;
  episode: number;
  title: string;
  cover_url: string | null;
  quality: string;
  status: string;
  bytes_done: number;
  bytes_expected: number;
  segments_done: number;
  segments_total: number;
  audio_json: string;
  error: string | null;
  folder: string;
  created_at: string;
  updated_at: string;
}

const SETTINGS_KEY = "downloads.settings.v1";
const STATUSES = new Set<DownloadStatus>(["queued", "downloading", "paused", "done", "failed"]);
const COLUMNS: Record<string, string> = {
  title: "title",
  coverUrl: "cover_url",
  quality: "quality",
  status: "status",
  bytesDone: "bytes_done",
  bytesExpected: "bytes_expected",
  segmentsDone: "segments_done",
  segmentsTotal: "segments_total",
  audio: "audio_json",
  error: "error",
  folder: "folder",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

function toDownload(row: Row): StoredDownload {
  let audio: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.audio_json);
    if (Array.isArray(parsed)) audio = parsed.filter((value) => typeof value === "string");
  } catch {
    audio = [];
  }
  return {
    id: row.id,
    aniListId: row.anilist_id,
    episode: row.episode,
    title: row.title,
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    quality: DOWNLOAD_QUALITIES.includes(row.quality as DownloadQuality)
      ? (row.quality as DownloadQuality)
      : "720p",
    status: STATUSES.has(row.status as DownloadStatus) ? (row.status as DownloadStatus) : "failed",
    bytesDone: row.bytes_done,
    bytesExpected: row.bytes_expected,
    segmentsDone: row.segments_done,
    segmentsTotal: row.segments_total,
    audio,
    ...(row.error ? { error: row.error } : {}),
    folder: row.folder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDownloadStore(database: Database.Database): DownloadStore {
  database.exec(`
    CREATE TABLE IF NOT EXISTS anime_downloads_v1 (
      id TEXT PRIMARY KEY,
      anilist_id INTEGER NOT NULL CHECK (anilist_id > 0),
      episode INTEGER NOT NULL CHECK (episode > 0),
      title TEXT NOT NULL,
      cover_url TEXT,
      quality TEXT NOT NULL,
      status TEXT NOT NULL,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      bytes_expected INTEGER NOT NULL DEFAULT 0,
      segments_done INTEGER NOT NULL DEFAULT 0,
      segments_total INTEGER NOT NULL DEFAULT 0,
      audio_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      folder TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (anilist_id, episode)
    );
  `);
  const all = database.prepare<[], Row>(
    "SELECT * FROM anime_downloads_v1 ORDER BY created_at, anilist_id, episode",
  );
  const byId = database.prepare<[string], Row>("SELECT * FROM anime_downloads_v1 WHERE id = ?");
  const byEpisode = database.prepare<[number, number], Row>(
    "SELECT * FROM anime_downloads_v1 WHERE anilist_id = ? AND episode = ?",
  );
  const insert = database.prepare(`
    INSERT INTO anime_downloads_v1 (id, anilist_id, episode, title, cover_url, quality, status,
      bytes_done, bytes_expected, segments_done, segments_total, audio_json, error, folder,
      created_at, updated_at)
    VALUES (@id, @aniListId, @episode, @title, @coverUrl, @quality, @status, @bytesDone,
      @bytesExpected, @segmentsDone, @segmentsTotal, @audio, @error, @folder, @createdAt, @updatedAt)
  `);
  const remove = database.prepare("DELETE FROM anime_downloads_v1 WHERE id = ?");
  const readMeta = database.prepare<[string], { value: string }>(
    "SELECT value FROM app_meta WHERE key = ?",
  );
  const writeMeta = database.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  return {
    list: () => all.all().map(toDownload),
    get: (id) => {
      const row = byId.get(id);
      return row ? toDownload(row) : undefined;
    },
    findEpisode: (aniListId, episode) => {
      const row = byEpisode.get(aniListId, episode);
      return row ? toDownload(row) : undefined;
    },
    insert: (item) =>
      insert.run({
        ...item,
        coverUrl: item.coverUrl ?? null,
        audio: JSON.stringify(item.audio),
        error: item.error ?? null,
      }),
    update: (id, patch) => {
      const assignments: string[] = [];
      const values: Record<string, unknown> = { id };
      for (const [key, value] of Object.entries(patch)) {
        const column = COLUMNS[key];
        if (!column) continue;
        assignments.push(`${column} = @${key}`);
        values[key] = key === "audio" ? JSON.stringify(value) : value === undefined ? null : value;
      }
      if (!assignments.length) return;
      database
        .prepare(`UPDATE anime_downloads_v1 SET ${assignments.join(", ")} WHERE id = @id`)
        .run(values);
    },
    remove: (id) => remove.run(id),
    getSettings: (defaultFolder) => {
      const fallback: DownloadSettings = {
        folder: defaultFolder,
        limitBytes: DEFAULT_DOWNLOAD_LIMIT_BYTES,
        quality: "1080p",
      };
      const row = readMeta.get(SETTINGS_KEY);
      if (!row) return fallback;
      try {
        const raw = JSON.parse(row.value) as Partial<DownloadSettings>;
        return {
          folder: typeof raw.folder === "string" && raw.folder ? raw.folder : fallback.folder,
          limitBytes:
            typeof raw.limitBytes === "number" &&
            raw.limitBytes >= MIN_DOWNLOAD_LIMIT_BYTES &&
            raw.limitBytes <= MAX_DOWNLOAD_LIMIT_BYTES
              ? raw.limitBytes
              : fallback.limitBytes,
          quality: DOWNLOAD_QUALITIES.includes(raw.quality as DownloadQuality)
            ? (raw.quality as DownloadQuality)
            : fallback.quality,
        };
      } catch {
        return fallback;
      }
    },
    saveSettings: (settings) => writeMeta.run(SETTINGS_KEY, JSON.stringify(settings)),
  };
}
