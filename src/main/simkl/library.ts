import type Database from "better-sqlite3";
import type { MoreMediaType } from "../../shared/contracts";
import type { MoreHistoryEntry, MoreTrackerStatus } from "../more-library";

/** One movie or show from the viewer's Simkl library, normalized at the adapter edge. */
export interface SimklLibraryRow {
  type: MoreMediaType;
  simklId: number;
  /** Absent when Simkl has no TMDB ID for the title. */
  tmdbId?: number;
  title?: string;
  status: MoreTrackerStatus;
  rating?: number;
  watchedEpisodes: number;
  /** Simkl poster path (`<dir>/<hash>`); `simklPosterUrl` builds the image URL. */
  poster?: string;
  year?: number;
  totalEpisodes?: number;
  /** ISO time of the latest watch or list change. */
  updatedAt: string;
}

/** Simkl's CDN poster (190 px card size) for a stored poster path. */
export function simklPosterUrl(path: string | undefined): string | undefined {
  return path && /^[\w]{1,8}\/[\w]{6,40}$/.test(path)
    ? `https://simkl.in/posters/${path}_ca.webp`
    : undefined;
}

/** The parts of Simkl's API the sync needs; `SimklClient` implements it. */
export interface SimklReader {
  get(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
}

const MAX_ROWS = 20_000;
const SNAPSHOT_KEY = "simkl.activities.v1";
const SYNCED_AT_KEY = "simkl.synced-at.v1";
const STATUS: Record<string, MoreTrackerStatus> = {
  watching: "watching",
  plantowatch: "planning",
  hold: "paused",
  dropped: "dropped",
  completed: "completed",
};
// Simkl container names for the two types AniStream imports; anime stays with AniList.
const KINDS = [
  { type: "MOVIE", path: "movies", activity: "movies", item: "movie" },
  { type: "TV", path: "shows", activity: "tv_shows", item: "show" },
] as const;

export function parseSimklItems(payload: unknown, type: MoreMediaType): SimklLibraryRow[] {
  if (payload === null || payload === undefined) return [];
  if (!isRecord(payload)) throw new Error("Simkl returned an invalid library response.");
  const kind = KINDS.find((entry) => entry.type === type)!;
  const list = payload[kind.path];
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error("Simkl returned an invalid library response.");
  return list.slice(0, MAX_ROWS).flatMap((value): SimklLibraryRow[] => {
    if (!isRecord(value)) return [];
    const item = value[kind.item];
    const ids = isRecord(item) && isRecord(item.ids) ? item.ids : undefined;
    const simklId = ids?.simkl;
    const status = typeof value.status === "string" ? STATUS[value.status] : undefined;
    if (typeof simklId !== "number" || !Number.isInteger(simklId) || simklId <= 0 || !status)
      return [];
    const tmdb =
      typeof ids?.tmdb === "string" || typeof ids?.tmdb === "number" ? String(ids.tmdb) : "";
    const tmdbId = /^\d{1,9}$/.test(tmdb) && Number(tmdb) > 0 ? Number(tmdb) : undefined;
    const rating =
      typeof value.user_rating === "number" &&
      Number.isInteger(value.user_rating) &&
      value.user_rating >= 1 &&
      value.user_rating <= 10
        ? value.user_rating
        : undefined;
    const watched =
      typeof value.watched_episodes_count === "number" && value.watched_episodes_count > 0
        ? Math.min(100_000, Math.floor(value.watched_episodes_count))
        : 0;
    const updatedAt =
      [value.last_watched_at, value.user_rated_at, value.added_to_watchlist_at]
        .filter(
          (time): time is string => typeof time === "string" && Number.isFinite(Date.parse(time)),
        )
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? new Date(0).toISOString();
    const title =
      isRecord(item) && typeof item.title === "string" ? item.title.trim().slice(0, 300) : "";
    const poster =
      isRecord(item) && typeof item.poster === "string" && simklPosterUrl(item.poster)
        ? item.poster
        : undefined;
    const year =
      isRecord(item) &&
      typeof item.year === "number" &&
      Number.isInteger(item.year) &&
      item.year > 1800 &&
      item.year < 2200
        ? item.year
        : undefined;
    const total =
      typeof value.total_episodes_count === "number" && value.total_episodes_count > 0
        ? Math.min(100_000, Math.floor(value.total_episodes_count))
        : undefined;
    return [
      {
        type,
        simklId,
        tmdbId,
        title: title || undefined,
        status,
        rating,
        // A finished movie counts as one finished "episode", like local playback evidence.
        watchedEpisodes: type === "MOVIE" && status === "completed" ? 1 : watched,
        poster,
        year,
        totalEpisodes: type === "TV" ? total : undefined,
        updatedAt,
      },
    ];
  });
}

export interface SimklLibraryStore {
  rows(): SimklLibraryRow[];
  replace(type: MoreMediaType, rows: readonly SimklLibraryRow[]): void;
  upsert(rows: readonly SimklLibraryRow[]): void;
  clear(): void;
  snapshot(): SimklActivities | undefined;
  saveSnapshot(snapshot: SimklActivities, syncedAt: number): void;
  syncedAt(): number | undefined;
}

export function createSimklLibraryStore(db: Database.Database): SimklLibraryStore {
  db.exec(`CREATE TABLE IF NOT EXISTS simkl_library_v1 (
    media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
    simkl_id INTEGER NOT NULL CHECK (simkl_id > 0),
    tmdb_id INTEGER CHECK (tmdb_id IS NULL OR tmdb_id > 0),
    title TEXT,
    status TEXT NOT NULL,
    rating INTEGER,
    watched_episodes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (media_type, simkl_id)
  );`);
  // Posters, years and episode totals (profile library, 2026-10-06). Libraries imported before
  // them lack these, so the saved activity snapshot is dropped and the next sync pulls in full.
  const columns = db
    .prepare<[], { name: string }>("PRAGMA table_info(simkl_library_v1)")
    .all()
    .map((column) => column.name);
  if (!columns.includes("poster"))
    db.transaction(() => {
      db.exec(`ALTER TABLE simkl_library_v1 ADD COLUMN poster TEXT;
        ALTER TABLE simkl_library_v1 ADD COLUMN year INTEGER;
        ALTER TABLE simkl_library_v1 ADD COLUMN total_episodes INTEGER;`);
      db.prepare("DELETE FROM app_meta WHERE key=?").run(SNAPSHOT_KEY);
    })();
  const write = db.prepare(
    `INSERT INTO simkl_library_v1 (media_type, simkl_id, tmdb_id, title, status, rating,
       watched_episodes, updated_at, poster, year, total_episodes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_type, simkl_id) DO UPDATE SET tmdb_id=excluded.tmdb_id, title=excluded.title,
       status=excluded.status, rating=excluded.rating, watched_episodes=excluded.watched_episodes,
       updated_at=excluded.updated_at, poster=excluded.poster, year=excluded.year,
       total_episodes=excluded.total_episodes`,
  );
  const insert = (rows: readonly SimklLibraryRow[]): void => {
    for (const row of rows)
      write.run(
        row.type,
        row.simklId,
        row.tmdbId ?? null,
        row.title ?? null,
        row.status,
        row.rating ?? null,
        row.watchedEpisodes,
        row.updatedAt,
        row.poster ?? null,
        row.year ?? null,
        row.totalEpisodes ?? null,
      );
  };
  const readMeta = db.prepare<[string], { value: string }>(
    "SELECT value FROM app_meta WHERE key=?",
  );
  const writeMeta = db.prepare(
    "INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  return {
    rows: () =>
      db
        .prepare<
          [],
          {
            media_type: MoreMediaType;
            simkl_id: number;
            tmdb_id: number | null;
            title: string | null;
            status: MoreTrackerStatus;
            rating: number | null;
            watched_episodes: number;
            updated_at: string;
            poster: string | null;
            year: number | null;
            total_episodes: number | null;
          }
        >(`SELECT * FROM simkl_library_v1 LIMIT ${MAX_ROWS}`)
        .all()
        .map((row) => ({
          type: row.media_type,
          simklId: row.simkl_id,
          tmdbId: row.tmdb_id ?? undefined,
          title: row.title ?? undefined,
          status: row.status,
          rating: row.rating ?? undefined,
          watchedEpisodes: row.watched_episodes,
          poster: row.poster ?? undefined,
          year: row.year ?? undefined,
          totalEpisodes: row.total_episodes ?? undefined,
          updatedAt: row.updated_at,
        })),
    replace: (type, rows) =>
      db.transaction(() => {
        db.prepare("DELETE FROM simkl_library_v1 WHERE media_type=?").run(type);
        insert(rows);
      })(),
    upsert: (rows) => db.transaction(() => insert(rows))(),
    clear: () =>
      db.transaction(() => {
        db.prepare("DELETE FROM simkl_library_v1").run();
        db.prepare("DELETE FROM app_meta WHERE key IN (?, ?)").run(SNAPSHOT_KEY, SYNCED_AT_KEY);
      })(),
    snapshot: () => {
      const value = readMeta.get(SNAPSHOT_KEY)?.value;
      if (!value) return undefined;
      try {
        return parseActivities(JSON.parse(value));
      } catch {
        return undefined;
      }
    },
    saveSnapshot: (snapshot, syncedAt) =>
      db.transaction(() => {
        writeMeta.run(SNAPSHOT_KEY, JSON.stringify(snapshot));
        writeMeta.run(SYNCED_AT_KEY, String(syncedAt));
      })(),
    syncedAt: () => {
      const value = Number(readMeta.get(SYNCED_AT_KEY)?.value);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    },
  };
}

/** The `/sync/activities` fields the sync compares; timestamps are kept exactly as returned. */
export interface SimklActivities {
  all?: string;
  movies?: ActivityBucket;
  tv_shows?: ActivityBucket;
}
type ActivityBucket = { all?: string; rated_at?: string; removed_from_list?: string };

export function parseActivities(payload: unknown): SimklActivities {
  if (!isRecord(payload)) throw new Error("Simkl returned invalid activity data.");
  const time = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;
  const bucket = (value: unknown): ActivityBucket | undefined =>
    isRecord(value)
      ? {
          all: time(value.all),
          rated_at: time(value.rated_at),
          removed_from_list: time(value.removed_from_list),
        }
      : undefined;
  return {
    all: time(payload.all),
    movies: bucket(payload.movies),
    tv_shows: bucket(payload.tv_shows),
  };
}

/**
 * Simkl's documented two-phase sync: `/sync/activities` first; a full pull per type once (or after
 * removals and rating-only changes, which a delta does not carry); otherwise a `date_from` delta
 * only for the types whose bucket moved. The snapshot is saved only after every fetch succeeds.
 */
export async function syncSimklLibrary(
  reader: SimklReader,
  store: SimklLibraryStore,
  now: number,
  signal?: AbortSignal,
): Promise<{ changed: boolean }> {
  const current = parseActivities(await reader.get("/sync/activities", {}, signal));
  const saved = store.snapshot();
  if (saved?.all && saved.all === current.all) {
    store.saveSnapshot(current, now);
    return { changed: false };
  }
  let changed = false;
  for (const kind of KINDS) {
    const before = saved?.[kind.activity];
    const after = current[kind.activity];
    if (saved && before?.all === after?.all) continue;
    // A null bucket means nothing of this type was ever added; there is nothing to fetch.
    if (!after?.all) {
      store.replace(kind.type, []);
      continue;
    }
    const full =
      !saved?.all ||
      !before ||
      before.removed_from_list !== after?.removed_from_list ||
      before.rated_at !== after?.rated_at;
    const payload = await reader.get(
      `/sync/all-items/${kind.path}`,
      full ? {} : { date_from: saved.all! },
      signal,
    );
    const rows = parseSimklItems(payload, kind.type);
    if (full) store.replace(kind.type, rows);
    else store.upsert(rows);
    changed = true;
  }
  store.saveSnapshot(current, now);
  return { changed };
}

/** Simkl rows as More history evidence; titles without a TMDB ID cannot be matched yet. */
export function simklHistory(rows: readonly SimklLibraryRow[]): MoreHistoryEntry[] {
  return rows.flatMap((row) =>
    row.tmdbId === undefined
      ? []
      : [
          {
            type: row.type,
            tmdbId: row.tmdbId,
            title: row.title,
            watchlisted: row.status === "planning",
            maxRatio: 0,
            finishedEpisodes: row.watchedEpisodes,
            updatedAt: row.updatedAt,
            trackerStatus: row.status,
            rating: row.rating,
          },
        ],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
