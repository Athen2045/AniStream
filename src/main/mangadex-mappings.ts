import type Database from "better-sqlite3";

/**
 * Durable AniList → MangaDex identity, written only after the exact `attributes.links.al` check
 * passed (or definitively failed). It lets library-wide availability skip the title search on
 * later launches; it never establishes identity on its own.
 */
export interface MangaDexMappingStore {
  /** The MangaDex ID, `null` for a recent "no exact mapping", or undefined when unknown/expired. */
  get(aniListId: number, now: number): string | null | undefined;
  save(aniListId: number, mangaDexId: string | null, now: number): void;
  forget(aniListId: number): void;
}

/** Conservative application policy: re-verify a match monthly, a miss after three days. */
export const MAPPED_TTL_MS = 30 * 24 * 60 * 60_000;
export const UNMAPPED_TTL_MS = 3 * 24 * 60 * 60_000;
const MAX_ROWS = 5_000;
const MANGADEX_ID = /^[0-9a-f-]{36}$/;

export function createMangaDexMappingStore(db: Database.Database): MangaDexMappingStore {
  db.exec(`CREATE TABLE IF NOT EXISTS mangadex_mapping_v1 (
    anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
    mangadex_id TEXT,
    checked_at INTEGER NOT NULL
  );`);
  const read = db.prepare<[number], { mangadex_id: string | null; checked_at: number }>(
    "SELECT mangadex_id, checked_at FROM mangadex_mapping_v1 WHERE anilist_id=?",
  );
  const write = db.prepare(
    `INSERT INTO mangadex_mapping_v1 VALUES (?, ?, ?)
     ON CONFLICT(anilist_id) DO UPDATE SET mangadex_id=excluded.mangadex_id, checked_at=excluded.checked_at`,
  );
  const trim = db.prepare(
    `DELETE FROM mangadex_mapping_v1 WHERE anilist_id NOT IN
     (SELECT anilist_id FROM mangadex_mapping_v1 ORDER BY checked_at DESC LIMIT ${MAX_ROWS})`,
  );
  const remove = db.prepare("DELETE FROM mangadex_mapping_v1 WHERE anilist_id=?");
  return {
    get(aniListId, now) {
      const row = read.get(aniListId);
      if (!row) return undefined;
      if (row.mangadex_id !== null && !MANGADEX_ID.test(row.mangadex_id)) return undefined;
      const ttl = row.mangadex_id === null ? UNMAPPED_TTL_MS : MAPPED_TTL_MS;
      return now - row.checked_at < ttl ? row.mangadex_id : undefined;
    },
    save(aniListId, mangaDexId, now) {
      if (!Number.isInteger(aniListId) || aniListId <= 0) return;
      if (mangaDexId !== null && !MANGADEX_ID.test(mangaDexId)) return;
      db.transaction(() => {
        write.run(aniListId, mangaDexId, now);
        trim.run();
      })();
    },
    forget(aniListId) {
      remove.run(aniListId);
    },
  };
}
