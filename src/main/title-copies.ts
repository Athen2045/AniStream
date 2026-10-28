import type Database from "better-sqlite3";

/**
 * Saved copies of what a title page loads (AniList details, episode list, story arcs, episode art,
 * season list) so the page still works offline. Network first: a live answer replaces the copy, and
 * the copy is only served when the live load fails. Titles with downloads keep their copies; other
 * titles keep the most recently opened ones.
 */
export interface TitleCopies {
  read(key: string): unknown;
  write(key: string, mediaId: number, value: unknown): void;
  /** The saved copies of titles with downloads whose key starts with `prefix`. */
  pinned(prefix: string): unknown[];
}

/** Copies kept for titles without downloads (a conservative local policy). */
const KEEP_RECENT_KEYS = 2_500;
/** About five keys per title: details, episodes, arcs, art, seasons. */
const TRIM_EVERY_WRITES = 50;

export function createTitleCopies(
  database: Database.Database,
  pinnedMediaIds: () => Iterable<number>,
): TitleCopies {
  database.exec(`
    CREATE TABLE IF NOT EXISTS title_copy_v1 (
      key TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_title_copy_saved ON title_copy_v1 (saved_at DESC);
  `);
  const read = database.prepare<[string], { payload: string }>(
    "SELECT payload FROM title_copy_v1 WHERE key = ?",
  );
  const write = database.prepare(`
    INSERT INTO title_copy_v1 (key, media_id, payload, saved_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET media_id = excluded.media_id, payload = excluded.payload,
      saved_at = excluded.saved_at
  `);
  let writes = 0;
  // Strictly increasing save times, so copies saved within one millisecond still trim oldest first.
  let lastSavedAt =
    database
      .prepare<[], { at: number | null }>("SELECT MAX(saved_at) AS at FROM title_copy_v1")
      .get()?.at ?? 0;
  const pinnedIds = (): number[] => [...new Set(pinnedMediaIds())].filter(Number.isInteger);
  const parse = (payload: string): unknown => {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  };
  const trim = (): void => {
    const pinned = pinnedIds();
    database
      .prepare(
        `DELETE FROM title_copy_v1
         WHERE media_id NOT IN (${pinned.map(() => "?").join(",") || "NULL"})
           AND key NOT IN (SELECT key FROM title_copy_v1 ORDER BY saved_at DESC LIMIT ${KEEP_RECENT_KEYS})`,
      )
      .run(...pinned);
  };
  return {
    read(key) {
      const row = read.get(key);
      return row ? parse(row.payload) : undefined;
    },
    pinned(prefix) {
      const ids = pinnedIds();
      if (!ids.length) return [];
      return database
        .prepare<unknown[], { payload: string }>(
          `SELECT payload FROM title_copy_v1
           WHERE media_id IN (${ids.map(() => "?").join(",")}) AND substr(key, 1, ?) = ?`,
        )
        .all(...ids, prefix.length, prefix)
        .map((row) => parse(row.payload))
        .filter((value) => value !== undefined);
    },
    write(key, mediaId, value) {
      lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
      write.run(key, mediaId, JSON.stringify(value), lastSavedAt);
      writes += 1;
      if (writes % TRIM_EVERY_WRITES === 0) trim();
    },
  };
}

/**
 * Loads live and saves a copy; when the live load fails (or returns nothing usable), serves the
 * saved copy instead. Without a copy, the live failure stands.
 */
export async function withTitleCopy<T>(
  copies: TitleCopies | undefined,
  key: string,
  mediaId: number,
  load: () => Promise<T>,
  usable: (value: T) => boolean = () => true,
): Promise<T> {
  let value: T;
  try {
    value = await load();
  } catch (error) {
    const saved = copies?.read(key);
    if (saved !== undefined) return saved as T;
    throw error;
  }
  if (usable(value)) {
    try {
      copies?.write(key, mediaId, value);
    } catch {
      // A failed save never fails the page.
    }
    return value;
  }
  const saved = copies?.read(key);
  return saved !== undefined ? (saved as T) : value;
}
