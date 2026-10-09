import type {
  BackupBingeEntry,
  BackupTitle,
  BackupUpNext,
  LocalBackup,
} from "../shared/local-backup";
import {
  BINGE_LIST_LIMIT,
  BINGE_PLAYLIST_LIMIT,
  bingeItemKey,
  parseBingeItem,
  parseBingeName,
} from "../shared/binge";
import { parseReaderSettings } from "../shared/reader-settings";
import {
  isValidMangaReadingResumeInput,
  isValidPlaybackResumeInput,
} from "../shared/resume-validation";

export const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
const invalid = (): never => {
  throw new Error("This file is not a valid AniStream local backup.");
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  return value;
}
function number(value: unknown, min = 0, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    return invalid();
  return value;
}
function id(value: unknown): number {
  const result = number(value, 1, 2147483647);
  return Number.isInteger(result) ? result : invalid();
}
function date(value: unknown): string {
  const result = text(value, 24);
  const timestamp = Date.parse(result);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== result) return invalid();
  return result;
}
function safeId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const result = text(value, 160);
  return /^[A-Za-z0-9_-]+$/.test(result) ? result : invalid();
}
function bingeEntries(value: unknown): BackupBingeEntry[] {
  return rows(
    value,
    BINGE_LIST_LIMIT,
    (raw) => {
      const row = record(raw);
      const item = parseBingeItem(row.item);
      return item ? { item, addedAt: date(row.addedAt) } : invalid();
    },
    (row) => bingeItemKey(row.item),
  );
}

/** Up Next and playlists, rebuilt with the same rules the app applies to its own lists. */
function parseUpNext(value: unknown): BackupUpNext {
  const raw = record(value);
  return {
    queue: bingeEntries(raw.queue),
    playlists: rows(
      raw.playlists,
      BINGE_PLAYLIST_LIMIT,
      (item) => {
        const row = record(item);
        const name = parseBingeName(row.name);
        return name
          ? { name, updatedAt: date(row.updatedAt), entries: bingeEntries(row.entries) }
          : invalid();
      },
      (row) => row.name.toLowerCase(),
    ),
  };
}

function rows<T>(
  value: unknown,
  max: number,
  parse: (raw: unknown) => T,
  key: (row: T) => string | number,
): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  const result = value.map(parse);
  if (new Set(result.map(key)).size !== result.length) return invalid();
  return result;
}

function parseTitle(value: unknown): BackupTitle {
  const row = record(value);
  const aniListId = id(row.aniListId);
  if (row.type !== "ANIME" && row.type !== "MANGA") return invalid();
  const result: BackupTitle = { aniListId, type: row.type, title: text(row.title, 500) };
  if (row.activity !== undefined) {
    const activity = record(row.activity);
    if (activity.state !== "started" && activity.state !== "completed") return invalid();
    const unit = number(activity.unit, row.type === "ANIME" ? 1 : 0);
    const completedProgress = number(activity.completedProgress);
    if (!Number.isInteger(completedProgress) || (row.type === "ANIME" && !Number.isInteger(unit)))
      return invalid();
    if (activity.state === "completed" && completedProgress < Math.floor(unit)) return invalid();
    result.activity = {
      unit,
      state: activity.state,
      completedProgress,
      chapterId: safeId(activity.chapterId),
      updatedAt: date(activity.updatedAt),
    };
  }
  if (row.playback !== undefined) {
    const playback = record(row.playback);
    if (
      row.type !== "ANIME" ||
      playback.aniListId !== aniListId ||
      !isValidPlaybackResumeInput(playback)
    )
      return invalid();
    result.playback = {
      aniListId,
      episode: number(playback.episode, 1),
      positionSeconds: number(playback.positionSeconds),
      durationSeconds: number(playback.durationSeconds),
      updatedAt: date(playback.updatedAt),
    };
  }
  if (row.reading !== undefined) {
    const reading = record(row.reading);
    if (
      row.type !== "MANGA" ||
      reading.aniListId !== aniListId ||
      !isValidMangaReadingResumeInput(reading)
    )
      return invalid();
    result.reading = {
      aniListId,
      chapterId: reading.chapterId,
      chapterNumber:
        reading.chapterNumber === undefined ? undefined : number(reading.chapterNumber),
      progress: reading.progress,
      updatedAt: date(reading.updatedAt),
    };
  }
  if (!result.activity && !result.playback && !result.reading) return invalid();
  return result;
}

/** Rebuild every object from allowed fields, including on export. Never serialize raw SQL rows. */
export function parseLocalBackup(value: unknown): LocalBackup {
  const raw = record(value);
  if (raw.format !== "anistream-local-backup" || raw.version !== 1) return invalid();
  return {
    format: "anistream-local-backup",
    version: 1,
    exportedAt: date(raw.exportedAt),
    titles: rows(raw.titles, 10_000, parseTitle, (row) => row.aniListId),
    mangaPreferences: rows(
      raw.mangaPreferences,
      10_000,
      (value) => {
        const row = record(value);
        const translatedLanguage = text(row.translatedLanguage, 7);
        if (!/^[a-z]{2}(?:-[a-z]{2,4})?$/.test(translatedLanguage)) return invalid();
        return {
          aniListId: id(row.aniListId),
          translatedLanguage,
          preferredGroupId: safeId(row.preferredGroupId),
          updatedAt: date(row.updatedAt),
        };
      },
      (row) => row.aniListId,
    ),
    // Release notices were removed; older backups may still list them and they are ignored.
    releaseAcknowledgements: [],
    readerSettings: raw.readerSettings === null ? null : parseReaderSettings(raw.readerSettings),
    ...(raw.upNext === undefined ? {} : { upNext: parseUpNext(raw.upNext) }),
  };
}
