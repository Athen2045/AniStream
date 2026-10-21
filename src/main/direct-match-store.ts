import type Database from "better-sqlite3";

/**
 * Durable AniList → direct-source series identity, written only after the exact match checks in
 * `matchDirectSeries` passed. It lets playback and downloads skip the title search on later
 * launches; it never establishes identity on its own. Misses are not stored (a momentary empty
 * search page must not hide a title for long).
 */
export interface DirectMatchStore {
  /** The stored slug and whether it is due for re-checking, or undefined when unknown. */
  get(aniListId: number, now: number): { slug: string; stale: boolean } | undefined;
  save(aniListId: number, slug: string, now: number): void;
  forget(aniListId: number): void;
}

/** Conservative application policy: re-check a stored match monthly. */
export const DIRECT_MATCH_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_ROWS = 5_000;
const SLUG = /^[a-z0-9]{4,32}$/i;

export function createDirectMatchStore(db: Database.Database): DirectMatchStore {
  db.exec(`CREATE TABLE IF NOT EXISTS anime_direct_match_v1 (
    anilist_id INTEGER PRIMARY KEY CHECK (anilist_id > 0),
    slug TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  );`);
  const read = db.prepare<[number], { slug: string; checked_at: number }>(
    "SELECT slug, checked_at FROM anime_direct_match_v1 WHERE anilist_id=?",
  );
  const write = db.prepare(
    `INSERT INTO anime_direct_match_v1 VALUES (?, ?, ?)
     ON CONFLICT(anilist_id) DO UPDATE SET slug=excluded.slug, checked_at=excluded.checked_at`,
  );
  const trim = db.prepare(
    `DELETE FROM anime_direct_match_v1 WHERE anilist_id NOT IN
     (SELECT anilist_id FROM anime_direct_match_v1 ORDER BY checked_at DESC LIMIT ${MAX_ROWS})`,
  );
  const remove = db.prepare("DELETE FROM anime_direct_match_v1 WHERE anilist_id=?");
  return {
    get(aniListId, now) {
      const row = read.get(aniListId);
      if (!row || !SLUG.test(row.slug)) return undefined;
      return { slug: row.slug, stale: now - row.checked_at >= DIRECT_MATCH_TTL_MS };
    },
    save(aniListId, slug, now) {
      if (!Number.isInteger(aniListId) || aniListId <= 0 || !SLUG.test(slug)) return;
      db.transaction(() => {
        write.run(aniListId, slug, now);
        trim.run();
      })();
    },
    forget(aniListId) {
      remove.run(aniListId);
    },
  };
}
