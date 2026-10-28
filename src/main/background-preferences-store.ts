import type Database from "better-sqlite3";
import {
  DEFAULT_BACKGROUND_PREFERENCES,
  parseBackgroundPreferences,
  type BackgroundPreferences,
} from "../shared/background";

export interface BackgroundPreferencesStore {
  read(): BackgroundPreferences;
  write(preferences: BackgroundPreferences): BackgroundPreferences;
}

export function createBackgroundPreferencesStore(
  database: Database.Database,
): BackgroundPreferencesStore {
  const key = "background.preferences.v1";
  return {
    read() {
      const row = database
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(key);
      try {
        return (
          (row && parseBackgroundPreferences(JSON.parse(row.value))) || {
            ...DEFAULT_BACKGROUND_PREFERENCES,
          }
        );
      } catch {
        return { ...DEFAULT_BACKGROUND_PREFERENCES };
      }
    },
    write(preferences) {
      const parsed = parseBackgroundPreferences(preferences);
      if (!parsed) throw new Error("Invalid background preferences.");
      database
        .prepare(
          "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(parsed));
      return parsed;
    },
  };
}
