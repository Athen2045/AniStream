import Database from "better-sqlite3";
import type { PlaybackResume, SavePlaybackResumeInput } from "../shared/contracts";

export interface AppDatabase {
  readonly ready: boolean;
  getPlaybackResume(aniListId: number): PlaybackResume | undefined;
  savePlaybackResume(input: SavePlaybackResumeInput): void;
  clearPlaybackResume(aniListId: number): void;
  close(): void;
}

export function openAppDatabase(path: string): AppDatabase {
  const database = new Database(path);

  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      media_key TEXT PRIMARY KEY,
      media_kind TEXT NOT NULL CHECK (media_kind IN ('anime', 'manga')),
      status TEXT NOT NULL,
      score REAL,
      progress INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playback_resume (
      anilist_id INTEGER PRIMARY KEY,
      episode INTEGER NOT NULL CHECK (episode > 0),
      position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
      duration_seconds REAL NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      updated_at TEXT NOT NULL
    );
  `);

  const readPlaybackResume = database.prepare<[number], PlaybackResumeRow>(`
    SELECT
      anilist_id,
      episode,
      position_seconds,
      duration_seconds,
      updated_at
    FROM playback_resume
    WHERE anilist_id = ?
  `);
  const writePlaybackResume = database.prepare(`
    INSERT INTO playback_resume (
      anilist_id,
      episode,
      position_seconds,
      duration_seconds,
      updated_at
    ) VALUES (
      @aniListId,
      @episode,
      @positionSeconds,
      @durationSeconds,
      @updatedAt
    )
    ON CONFLICT(anilist_id) DO UPDATE SET
      episode = excluded.episode,
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      updated_at = excluded.updated_at
  `);
  const deletePlaybackResume = database.prepare("DELETE FROM playback_resume WHERE anilist_id = ?");

  return {
    ready: true,
    getPlaybackResume: (aniListId) => {
      if (!Number.isInteger(aniListId) || aniListId <= 0) {
        throw new Error("Invalid AniList media ID.");
      }
      const row = readPlaybackResume.get(aniListId);
      return row
        ? {
            aniListId: row.anilist_id,
            episode: row.episode,
            positionSeconds: row.position_seconds,
            durationSeconds: row.duration_seconds,
            updatedAt: row.updated_at,
          }
        : undefined;
    },
    savePlaybackResume: (input) => {
      if (!isValidPlaybackResume(input)) throw new Error("Invalid playback resume state.");
      writePlaybackResume.run({ ...input, updatedAt: new Date().toISOString() });
    },
    clearPlaybackResume: (aniListId) => {
      if (!Number.isInteger(aniListId) || aniListId <= 0) {
        throw new Error("Invalid AniList media ID.");
      }
      deletePlaybackResume.run(aniListId);
    },
    close: () => database.close(),
  };
}

interface PlaybackResumeRow {
  anilist_id: number;
  episode: number;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

function isValidPlaybackResume(input: SavePlaybackResumeInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    Number.isInteger(input.episode) &&
    input.episode > 0 &&
    Number.isFinite(input.positionSeconds) &&
    input.positionSeconds >= 0 &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds >= 0 &&
    input.positionSeconds <= Math.max(input.durationSeconds + 30, 30)
  );
}
