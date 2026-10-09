import type Database from "better-sqlite3";

export interface StoredUpdatePreferences {
  autoDownload: boolean;
  installOnQuit: boolean;
}
export interface UpdatePreferencesStore {
  read(): StoredUpdatePreferences;
  write(preferences: StoredUpdatePreferences): void;
}

/** Background download on, install only on the user's click (user decision 2026-10-10). */
export const DEFAULT_UPDATE_PREFERENCES: StoredUpdatePreferences = {
  autoDownload: true,
  installOnQuit: false,
};

export function parseUpdatePreferences(value: unknown): StoredUpdatePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid update preferences.");
  const record = value as Record<string, unknown>;
  if (typeof record.autoDownload !== "boolean" || typeof record.installOnQuit !== "boolean")
    throw new Error("Invalid update preferences.");
  return { autoDownload: record.autoDownload, installOnQuit: record.installOnQuit };
}

export function createUpdatePreferencesStore(database: Database.Database): UpdatePreferencesStore {
  const key = "update.preferences.v1";
  return {
    read() {
      const row = database
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(key);
      if (!row) return { ...DEFAULT_UPDATE_PREFERENCES };
      try {
        return parseUpdatePreferences(JSON.parse(row.value));
      } catch {
        return { ...DEFAULT_UPDATE_PREFERENCES };
      }
    },
    write(preferences) {
      database
        .prepare(
          "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(parseUpdatePreferences(preferences)));
    },
  };
}
