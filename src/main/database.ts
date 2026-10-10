import Database from "better-sqlite3";
import { serializeDashboardForCache } from "./dashboard-cache";
import { createUpdateLaunchStore, type UpdateLaunchStore } from "./update-launch-store";
import {
  createUpdatePreferencesStore,
  type UpdatePreferencesStore,
} from "./update-preferences-store";
import { createBackupRepository, type BackupRepository } from "./backup-repository";
import { createReaderSettingsRepository, type ReaderSettingsRepository } from "./reader-settings";
import { createActivityRepository, type ActivityRepository } from "./activity/repository";
import { createEntryChangeRepository, type EntryChangeRepository } from "./entry-changes";
import { createMoreLibraryRepository, type MoreLibraryRepository } from "./more-library";
import { createBingeRepository, type BingeRepository } from "./binge-repository";
import type {
  AniListDashboard,
  MangaReadingResume,
  MorePlaybackInput,
  MorePlaybackResume,
  SaveMorePlaybackResumeInput,
  PlaybackResume,
} from "../shared/contracts";
import type { RecommendationRepository } from "./recommendations/repository";
import { createRecommendationRepository } from "./recommendations/repository";
import { createDiscoveryStore, type DiscoveryStore } from "./recommendations/discovery-store";
import { createSimklLibraryStore, type SimklLibraryStore } from "./simkl/library";
import { createSimklCatalogStore, type SimklCatalogStore } from "./simkl/collaborative";
import { createMangaDexMappingStore, type MangaDexMappingStore } from "./mangadex-mappings";
import { createSnapshotStore, type SnapshotStore } from "./field-snapshots";
import {
  createPersonalizationStore,
  type PersonalizationStore,
} from "./recommendations/personalization-store";
import { AnimeTmdbLinks } from "./anime-tmdb-links";
import {
  createMoreDiscoveryStore,
  type MoreDiscoveryStore,
} from "./recommendations/more-discovery-store";
import {
  createMangaPreferenceRepository,
  type MangaPreferenceRepository,
} from "./manga-preferences";

export interface AppDatabase
  extends
    RecommendationRepository,
    ActivityRepository,
    EntryChangeRepository,
    MangaPreferenceRepository,
    MoreLibraryRepository,
    BingeRepository,
    ReaderSettingsRepository {
  readonly ready: boolean;
  readonly discovery: DiscoveryStore;
  readonly moreDiscovery: MoreDiscoveryStore;
  readonly animeTmdbLinks: AnimeTmdbLinks;
  readonly simklLibrary: SimklLibraryStore;
  readonly simklCatalog: SimklCatalogStore;
  readonly mangaDexMappings: MangaDexMappingStore;
  readonly fieldSnapshots: SnapshotStore;
  readonly personalization: PersonalizationStore;
  readonly backup: BackupRepository;
  readonly updateLaunch: UpdateLaunchStore;
  readonly updatePreferences: UpdatePreferencesStore;
  getCachedAniListDashboard(): AniListDashboard | undefined;
  saveCachedAniListDashboard(dashboard: AniListDashboard): void;
  clearCachedAniListDashboard(): void;
  getPlaybackResume(aniListId: number): PlaybackResume | undefined;
  getMangaReadingResume(aniListId: number): MangaReadingResume | undefined;
  getMorePlaybackResume(input: MorePlaybackInput): MorePlaybackResume | undefined;
  saveMorePlaybackResume(input: SaveMorePlaybackResumeInput): void;
  clearMorePlaybackResume(input: MorePlaybackInput): void;
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

    CREATE TABLE IF NOT EXISTS more_playback_resume (
      media_key TEXT PRIMARY KEY,
      tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
      season INTEGER,
      episode INTEGER,
      position_seconds REAL NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
      duration_seconds REAL NOT NULL CHECK (duration_seconds > 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anilist_id INTEGER NOT NULL CHECK (anilist_id > 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('ANIME', 'MANGA')),
      occurred_at INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      value REAL
    );

    CREATE INDEX IF NOT EXISTS idx_recommendation_events_time
      ON recommendation_events (occurred_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS recommendation_item_features (
      anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('ANIME', 'MANGA')),
      mal_id INTEGER,
      normalized_title TEXT NOT NULL,
      cover_url TEXT,
      features_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recommendation_item_features_updated
      ON recommendation_item_features (updated_at DESC);

    CREATE TABLE IF NOT EXISTS recommendation_impressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      anilist_id INTEGER NOT NULL CHECK (anilist_id > 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('ANIME', 'MANGA')),
      position INTEGER NOT NULL CHECK (position >= 0 AND position < 10),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
      result_json TEXT NOT NULL,
      shown_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_recommendation_impressions_request
      ON recommendation_impressions (request_id, position);
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
  const readMorePlaybackResume = database.prepare<[string], MorePlaybackResumeRow>(`
    SELECT tmdb_id, media_type, season, episode, position_seconds, duration_seconds, updated_at
    FROM more_playback_resume WHERE media_key = ?
  `);
  const writeMorePlaybackResume = database.prepare(`
    INSERT INTO more_playback_resume (
      media_key, tmdb_id, media_type, season, episode, position_seconds, duration_seconds, updated_at
    ) VALUES (@mediaKey, @tmdbId, @type, @season, @episode, @positionSeconds, @durationSeconds, @updatedAt)
    ON CONFLICT(media_key) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      updated_at = excluded.updated_at
  `);
  const deleteMorePlaybackResume = database.prepare(
    "DELETE FROM more_playback_resume WHERE media_key = ?",
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

  const recommendationRepository = createRecommendationRepository(database);
  const mangaPreferenceRepository = createMangaPreferenceRepository(database);
  const bingeRepository = createBingeRepository(database);

  return {
    ...createReaderSettingsRepository(database),
    ...createActivityRepository(database),
    ...createEntryChangeRepository(database),
    ...mangaPreferenceRepository,
    ...recommendationRepository,
    ...createMoreLibraryRepository(database),
    ...bingeRepository,
    discovery: createDiscoveryStore(database),
    moreDiscovery: createMoreDiscoveryStore(database),
    animeTmdbLinks: new AnimeTmdbLinks(database),
    simklLibrary: createSimklLibraryStore(database),
    simklCatalog: createSimklCatalogStore(database),
    mangaDexMappings: createMangaDexMappingStore(database),
    fieldSnapshots: createSnapshotStore(database),
    personalization: createPersonalizationStore(database),
    backup: createBackupRepository(database, bingeRepository),
    updateLaunch: createUpdateLaunchStore(database),
    updatePreferences: createUpdatePreferencesStore(database),
    ready: true,
    getCachedAniListDashboard: () => {
      const row = readAppMeta.get(dashboardCacheKey);
      return row ? parseCachedDashboard(row.value) : undefined;
    },
    saveCachedAniListDashboard: (dashboard) => {
      const serialized = serializeDashboardForCache(dashboard);
      if (!serialized) throw new Error("AniList dashboard snapshot is too large to persist.");
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
    getMorePlaybackResume: (input) => {
      validateMorePlaybackInput(input);
      const row = readMorePlaybackResume.get(morePlaybackKey(input));
      return row
        ? {
            tmdbId: row.tmdb_id,
            type: row.media_type,
            season: row.season ?? undefined,
            episode: row.episode ?? undefined,
            positionSeconds: row.position_seconds,
            durationSeconds: row.duration_seconds,
            updatedAt: row.updated_at,
          }
        : undefined;
    },
    saveMorePlaybackResume: (input) => {
      validateMorePlaybackInput(input);
      if (
        !Number.isFinite(input.positionSeconds) ||
        !Number.isFinite(input.durationSeconds) ||
        input.positionSeconds < 0 ||
        input.durationSeconds <= 0 ||
        input.positionSeconds > input.durationSeconds
      ) {
        throw new Error("Invalid More playback resume state.");
      }
      writeMorePlaybackResume.run({
        mediaKey: morePlaybackKey(input),
        tmdbId: input.tmdbId,
        type: input.type,
        season: input.season ?? null,
        episode: input.episode ?? null,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        updatedAt: new Date().toISOString(),
      });
    },
    clearMorePlaybackResume: (input) => {
      validateMorePlaybackInput(input);
      deleteMorePlaybackResume.run(morePlaybackKey(input));
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

interface MorePlaybackResumeRow {
  tmdb_id: number;
  media_type: "MOVIE" | "TV";
  season: number | null;
  episode: number | null;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

function validateAniListId(aniListId: number): void {
  if (!Number.isInteger(aniListId) || aniListId <= 0) {
    throw new Error("Invalid AniList media ID.");
  }
}

function validateMorePlaybackInput(input: MorePlaybackInput): void {
  if (!Number.isInteger(input.tmdbId) || input.tmdbId <= 0)
    throw new Error("Invalid TMDB media ID.");
  if (input.type === "MOVIE") {
    if (input.season !== undefined || input.episode !== undefined)
      throw new Error("Movie playback cannot have an episode.");
    return;
  }
  if (
    input.type !== "TV" ||
    !Number.isInteger(input.season) ||
    (input.season ?? 0) <= 0 ||
    !Number.isInteger(input.episode) ||
    (input.episode ?? 0) <= 0
  )
    throw new Error("TV playback requires a season and episode.");
}

function morePlaybackKey(input: MorePlaybackInput): string {
  return `${input.type}:${input.tmdbId}:${input.season ?? 0}:${input.episode ?? 0}`;
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
