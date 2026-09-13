import type Database from "better-sqlite3";
import {
  DEFAULT_READER_SETTINGS,
  parseReaderSettings,
  type ReaderSettings,
} from "../shared/reader-settings";

export interface ReaderSettingsRepository {
  getReaderSettings(): ReaderSettings;
  saveReaderSettings(input: ReaderSettings): ReaderSettings;
}

export function createReaderSettingsRepository(
  database: Database.Database,
): ReaderSettingsRepository {
  const key = "reader.settings.v1";
  return {
    getReaderSettings() {
      const row = database
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(key);
      if (!row) return { ...DEFAULT_READER_SETTINGS };
      // Corrupt settings must be reported rather than silently overwriting them.
      return parseReaderSettings(JSON.parse(row.value));
    },
    saveReaderSettings(input) {
      const settings = parseReaderSettings(input);
      database
        .prepare(
          "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(settings));
      return settings;
    },
  };
}
