import type Database from "better-sqlite3";
import type { TitlePreferences } from "../shared/contracts";

/** English titles by default (user decision 2026-10-14). */
export const DEFAULT_TITLE_PREFERENCES: TitlePreferences = { english: true };

export interface TitlePreferencesStore {
  read(): TitlePreferences;
  write(preferences: TitlePreferences): void;
}

export function parseTitlePreferences(value: unknown): TitlePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid title preferences.");
  const record = value as Record<string, unknown>;
  if (typeof record.english !== "boolean") throw new Error("Invalid title preferences.");
  return { english: record.english };
}

export function createTitlePreferencesStore(database: Database.Database): TitlePreferencesStore {
  const key = "titles.preferences.v1";
  return {
    read() {
      const row = database
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(key);
      if (!row) return { ...DEFAULT_TITLE_PREFERENCES };
      try {
        return parseTitlePreferences(JSON.parse(row.value));
      } catch {
        return { ...DEFAULT_TITLE_PREFERENCES };
      }
    },
    write(preferences) {
      database
        .prepare(
          "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(parseTitlePreferences(preferences)));
    },
  };
}
