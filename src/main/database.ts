import Database from "better-sqlite3";

export interface AppDatabase {
  readonly ready: boolean;
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
  `);

  return {
    ready: true,
    close: () => database.close(),
  };
}

