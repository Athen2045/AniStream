import Database from "better-sqlite3";
import type {
  AniListDashboard,
  MangaReadingResume,
  PlaybackResume,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
} from "../shared/contracts";
import {
  isValidMangaReadingResumeInput,
  isValidPlaybackResumeInput,
} from "../shared/resume-validation";

export interface AppDatabase {
  readonly ready: boolean;
  getCachedAniListDashboard(): AniListDashboard | undefined;
  saveCachedAniListDashboard(dashboard: AniListDashboard): void;
  clearCachedAniListDashboard(): void;
  getPlaybackResume(aniListId: number): PlaybackResume | undefined;
  savePlaybackResume(input: SavePlaybackResumeInput): void;
  clearPlaybackResume(aniListId: number): void;
  getMangaReadingResume(aniListId: number): MangaReadingResume | undefined;
  saveMangaReadingResume(input: SaveMangaReadingResumeInput): void;
  clearMangaReadingResume(aniListId: number): void;
  close(): void;
}

export function openAppDatabase(path: string): AppDatabase {
  const database = new Database(path);

  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playback_resume (
      anilist_id INTEGER PRIMARY KEY,
      episode INTEGER NOT NULL CHECK (episode > 0),
      position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
      duration_seconds REAL NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manga_reading_resume (
      anilist_id INTEGER PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      chapter_number REAL,
      progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
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
  const readMangaReadingResume = database.prepare<[number], MangaReadingResumeRow>(`
    SELECT
      anilist_id,
      chapter_id,
      chapter_number,
      progress,
      updated_at
    FROM manga_reading_resume
    WHERE anilist_id = ?
  `);
  const writeMangaReadingResume = database.prepare(`
    INSERT INTO manga_reading_resume (
      anilist_id,
      chapter_id,
      chapter_number,
      progress,
      updated_at
    ) VALUES (
      @aniListId,
      @chapterId,
      @chapterNumber,
      @progress,
      @updatedAt
    )
    ON CONFLICT(anilist_id) DO UPDATE SET
      chapter_id = excluded.chapter_id,
      chapter_number = excluded.chapter_number,
      progress = excluded.progress,
      updated_at = excluded.updated_at
  `);
  const deleteMangaReadingResume = database.prepare(
    "DELETE FROM manga_reading_resume WHERE anilist_id = ?",
  );
  const readAppMeta = database.prepare<[string], { value: string }>(
    "SELECT value FROM app_meta WHERE key = ?",
  );
  const writeAppMeta = database.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const deleteAppMeta = database.prepare("DELETE FROM app_meta WHERE key = ?");
  const dashboardCacheKey = "anilist.dashboard.v1";

  return {
    ready: true,
    getCachedAniListDashboard: () => {
      const row = readAppMeta.get(dashboardCacheKey);
      return row ? parseCachedDashboard(row.value) : undefined;
    },
    saveCachedAniListDashboard: (dashboard) => {
      const serialized = JSON.stringify(dashboard);
      if (serialized.length > 2_000_000) {
        throw new Error("AniList dashboard snapshot is too large to persist.");
      }
      writeAppMeta.run(dashboardCacheKey, serialized);
    },
    clearCachedAniListDashboard: () => {
      deleteAppMeta.run(dashboardCacheKey);
    },
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
      if (!isValidPlaybackResumeInput(input)) throw new Error("Invalid playback resume state.");
      writePlaybackResume.run({ ...input, updatedAt: new Date().toISOString() });
    },
    clearPlaybackResume: (aniListId) => {
      if (!Number.isInteger(aniListId) || aniListId <= 0) {
        throw new Error("Invalid AniList media ID.");
      }
      deletePlaybackResume.run(aniListId);
    },
    getMangaReadingResume: (aniListId) => {
      validateAniListId(aniListId);
      const row = readMangaReadingResume.get(aniListId);
      return row
        ? {
            aniListId: row.anilist_id,
            chapterId: row.chapter_id,
            chapterNumber: row.chapter_number ?? undefined,
            progress: row.progress,
            updatedAt: row.updated_at,
          }
        : undefined;
    },
    saveMangaReadingResume: (input) => {
      if (!isValidMangaReadingResumeInput(input)) {
        throw new Error("Invalid manga reading resume state.");
      }
      writeMangaReadingResume.run({
        ...input,
        chapterNumber: input.chapterNumber ?? null,
        updatedAt: new Date().toISOString(),
      });
    },
    clearMangaReadingResume: (aniListId) => {
      validateAniListId(aniListId);
      deleteMangaReadingResume.run(aniListId);
    },
    close: () => {
      database.pragma("optimize");
      database.close();
    },
  };
}

interface PlaybackResumeRow {
  anilist_id: number;
  episode: number;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

interface MangaReadingResumeRow {
  anilist_id: number;
  chapter_id: string;
  chapter_number: number | null;
  progress: number;
  updated_at: string;
}

function validateAniListId(aniListId: number): void {
  if (!Number.isInteger(aniListId) || aniListId <= 0) {
    throw new Error("Invalid AniList media ID.");
  }
}

function parseCachedDashboard(value: string): AniListDashboard | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isCachedProfile(parsed.profile)) return undefined;
    if (!Array.isArray(parsed.animeLists) || !Array.isArray(parsed.mangaLists)) return undefined;
    if (typeof parsed.fetchedAt !== "string") return undefined;
    return parsed as unknown as AniListDashboard;
  } catch {
    return undefined;
  }
}

function isCachedProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.id) &&
    typeof value.name === "string" &&
    typeof value.avatarUrl === "string" &&
    typeof value.siteUrl === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
