import type Database from "better-sqlite3";
import type { MangaReaderPreferences, SaveMangaReaderPreferencesInput } from "../shared/contracts";

export interface MangaPreferenceRepository {
  getMangaReaderPreferences(aniListId: number): MangaReaderPreferences | undefined;
  saveMangaReaderPreferences(input: SaveMangaReaderPreferencesInput): MangaReaderPreferences;
}

interface PreferenceRow {
  anilist_id: number;
  translated_language: string;
  preferred_group_id: string | null;
  updated_at: string;
}

export function createMangaPreferenceRepository(
  database: Database.Database,
): MangaPreferenceRepository {
  database.exec(`
    CREATE TABLE IF NOT EXISTS manga_reader_preferences_v1 (
      anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
      translated_language TEXT NOT NULL,
      preferred_group_id TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO app_meta(key, value) VALUES ('manga-reader-preferences.schema', '1');
  `);
  const read = database.prepare<[number], PreferenceRow>(`
    SELECT anilist_id, translated_language, preferred_group_id, updated_at
    FROM manga_reader_preferences_v1 WHERE anilist_id = ?
  `);
  const write = database.prepare(`
    INSERT INTO manga_reader_preferences_v1 (
      anilist_id, translated_language, preferred_group_id, updated_at
    ) VALUES (@aniListId, @translatedLanguage, @preferredGroupId, @updatedAt)
    ON CONFLICT(anilist_id) DO UPDATE SET
      translated_language = excluded.translated_language,
      preferred_group_id = excluded.preferred_group_id,
      updated_at = excluded.updated_at
  `);

  const get = (aniListId: number): MangaReaderPreferences | undefined => {
    validateAniListId(aniListId);
    const row = read.get(aniListId);
    return row
      ? {
          aniListId: row.anilist_id,
          translatedLanguage: row.translated_language,
          preferredGroupId: row.preferred_group_id ?? undefined,
          updatedAt: row.updated_at,
        }
      : undefined;
  };

  return {
    getMangaReaderPreferences: get,
    saveMangaReaderPreferences: (input) => {
      if (!isValidMangaReaderPreferences(input)) {
        throw new Error("Invalid manga reader preferences.");
      }
      write.run({
        ...input,
        translatedLanguage: input.translatedLanguage.toLocaleLowerCase(),
        preferredGroupId: input.preferredGroupId ?? null,
        updatedAt: new Date().toISOString(),
      });
      return get(input.aniListId)!;
    },
  };
}

export function isValidMangaReaderPreferences(input: SaveMangaReaderPreferencesInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    /^[a-z]{2}(?:-[a-z]{2,4})?$/.test(input.translatedLanguage) &&
    (input.preferredGroupId === undefined || /^[A-Za-z0-9_-]{1,160}$/.test(input.preferredGroupId))
  );
}

function validateAniListId(aniListId: number): void {
  if (!Number.isInteger(aniListId) || aniListId <= 0) {
    throw new Error("Invalid AniList media ID.");
  }
}
