import type Database from "better-sqlite3";
import type {
  MoreCatalogItem,
  MoreContinueItem,
  MoreLibrary,
  MoreMediaType,
  MoreTitleProgress,
  MoreTitleRef,
  MoreTitleSnapshot,
} from "../shared/contracts";

/** Local, single-user More library: a watch list plus title snapshots for Continue Watching. */
export interface MoreLibraryRepository {
  getMoreLibrary(): MoreLibrary;
  getMoreTitleProgress(input: MoreTitleRef): MoreTitleProgress[];
  setMoreWatchlist(title: MoreTitleSnapshot, saved: boolean): void;
  /** "Already watched" without playing here; completing a title takes it off the watch list. */
  setMoreCompleted(title: MoreTitleSnapshot, completed: boolean): void;
  /** The viewer's own 1–10 rating given here; undefined clears it. */
  setMoreRating(title: MoreTitleSnapshot, rating: number | undefined): void;
  getMoreRating(ref: MoreTitleRef): number | undefined;
  rememberMoreTitle(title: MoreTitleSnapshot): void;
  /** Per-title watch evidence for local recommendations; never leaves the main process. */
  listMoreHistory(): MoreHistoryEntry[];
}

export interface MoreHistoryEntry {
  type: MoreMediaType;
  tmdbId: number;
  title?: string;
  watchlisted: boolean;
  /** Furthest progress ratio reached on any movie or episode, 0–1. */
  maxRatio: number;
  /** Furthest position reached in seconds; two minutes marks an intentional start. */
  maxPositionSeconds?: number;
  finishedEpisodes: number;
  updatedAt: string;
  /** List status: marked Completed here, or from a connected tracker (Simkl). */
  trackerStatus?: MoreTrackerStatus;
  /** The viewer's own 1–10 rating from a connected tracker. */
  rating?: number;
  /** "Interested" (1) or "Not interested" (-1) from the title page. */
  feedback?: 1 | -1;
}

export type MoreTrackerStatus = "watching" | "planning" | "paused" | "dropped" | "completed";

/**
 * Merges local playback evidence with tracker rows for the same title (`TYPE:tmdbId`): the
 * strongest progress wins, the tracker supplies status and rating, the newest time is kept.
 */
export function mergeMoreHistory(
  local: readonly MoreHistoryEntry[],
  tracker: readonly MoreHistoryEntry[],
): MoreHistoryEntry[] {
  const merged = new Map<string, MoreHistoryEntry>();
  for (const entry of [...local, ...tracker]) {
    const key = `${entry.type}:${entry.tmdbId}`;
    const known = merged.get(key);
    if (!known) {
      merged.set(key, { ...entry });
      continue;
    }
    merged.set(key, {
      ...known,
      title: known.title ?? entry.title,
      watchlisted: known.watchlisted || entry.watchlisted,
      maxRatio: Math.max(known.maxRatio, entry.maxRatio),
      maxPositionSeconds: Math.max(known.maxPositionSeconds ?? 0, entry.maxPositionSeconds ?? 0),
      feedback: known.feedback ?? entry.feedback,
      finishedEpisodes: Math.max(known.finishedEpisodes, entry.finishedEpisodes),
      updatedAt:
        Date.parse(entry.updatedAt) > Date.parse(known.updatedAt)
          ? entry.updatedAt
          : known.updatedAt,
      trackerStatus: entry.trackerStatus ?? known.trackerStatus,
      // A rating given here is the newest word; Simkl's copy catches up on the next sync.
      rating: known.rating ?? entry.rating,
    });
  }
  return [...merged.values()];
}

const TMDB_IMAGE_PATTERN =
  /^https:\/\/image\.tmdb\.org\/t\/p\/w(?:300|500|780|1280)\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,239}$/;
// Simkl CDN posters from the Trending and Custom List rows (`simkl.in/posters/<dir>/<hash>_<size>`).
const SIMKL_IMAGE_PATTERN =
  /^https:\/\/simkl\.in\/(?:posters|fanart)\/\d{1,4}\/[0-9a-f]{6,40}_(?:m|c|ca|w|medium)\.(?:webp|jpg)$/;
const CONTINUE_LIMIT = 20;
const WATCHLIST_LIMIT = 500;
const HISTORY_LIMIT = 1_000;
/** Progress at or beyond this fraction counts as finished. */
export const MORE_FINISHED_RATIO = 0.92;

/**
 * Normalizes an untrusted snapshot from the renderer. Image URLs must be bounded TMDB CDN URLs,
 * so the stored library can never point the renderer at an arbitrary host.
 */
export function parseMoreTitleSnapshot(value: unknown): MoreTitleSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { id, type, title, posterUrl, backdropUrl, year, score } = record;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
  if (type !== "MOVIE" && type !== "TV") return undefined;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 300) return undefined;
  const optionalImage = (url: unknown): string | undefined | null =>
    url === undefined
      ? undefined
      : typeof url === "string" && (TMDB_IMAGE_PATTERN.test(url) || SIMKL_IMAGE_PATTERN.test(url))
        ? url
        : null;
  const poster = optionalImage(posterUrl);
  const backdrop = optionalImage(backdropUrl);
  if (poster === null || backdrop === null) return undefined;
  if (
    year !== undefined &&
    (typeof year !== "number" || !Number.isInteger(year) || year < 1800 || year > 3000)
  )
    return undefined;
  if (
    score !== undefined &&
    (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 10)
  )
    return undefined;
  return {
    id,
    type,
    title: title.trim(),
    ...(poster ? { posterUrl: poster } : {}),
    ...(backdrop ? { backdropUrl: backdrop } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

interface TitleRow {
  tmdb_id: number;
  media_type: MoreMediaType;
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  year: number | null;
  score: number | null;
}

interface ProgressRow {
  season: number | null;
  episode: number | null;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
}

export function createMoreLibraryRepository(database: Database.Database): MoreLibraryRepository {
  database.exec(`
    CREATE TABLE IF NOT EXISTS more_titles (
      media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
      tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
      title TEXT NOT NULL,
      poster_url TEXT,
      backdrop_url TEXT,
      year INTEGER,
      score REAL,
      watchlisted_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (media_type, tmdb_id)
    );
    CREATE INDEX IF NOT EXISTS idx_more_titles_watchlist
      ON more_titles (watchlisted_at DESC) WHERE watchlisted_at IS NOT NULL;
  `);
  const titleColumns = database
    .prepare<[], { name: string }>("PRAGMA table_info(more_titles)")
    .all();
  if (!titleColumns.some((column) => column.name === "completed_at"))
    database.exec("ALTER TABLE more_titles ADD COLUMN completed_at TEXT");
  if (!titleColumns.some((column) => column.name === "rating"))
    database.exec(
      "ALTER TABLE more_titles ADD COLUMN rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 10)",
    );
  const setRating = database.prepare(
    "UPDATE more_titles SET rating = ? WHERE media_type = ? AND tmdb_id = ?",
  );
  const readRating = database.prepare<[string, number], { rating: number | null }>(
    "SELECT rating FROM more_titles WHERE media_type = ? AND tmdb_id = ?",
  );
  const setCompleted = database.prepare(
    `UPDATE more_titles SET completed_at = ?,
       watchlisted_at = CASE WHEN ? IS NULL THEN watchlisted_at ELSE NULL END
     WHERE media_type = ? AND tmdb_id = ?`,
  );
  const readCompleted = database.prepare<[], { media_type: MoreMediaType; tmdb_id: number }>(
    `SELECT media_type, tmdb_id FROM more_titles WHERE completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT ${HISTORY_LIMIT}`,
  );
  const upsertTitle = database.prepare(`
    INSERT INTO more_titles (media_type, tmdb_id, title, poster_url, backdrop_url, year, score, updated_at)
    VALUES (@type, @id, @title, @posterUrl, @backdropUrl, @year, @score, @updatedAt)
    ON CONFLICT(media_type, tmdb_id) DO UPDATE SET
      title = excluded.title,
      poster_url = COALESCE(excluded.poster_url, more_titles.poster_url),
      backdrop_url = COALESCE(excluded.backdrop_url, more_titles.backdrop_url),
      year = COALESCE(excluded.year, more_titles.year),
      score = COALESCE(excluded.score, more_titles.score),
      updated_at = excluded.updated_at
  `);
  const setWatchlisted = database.prepare(
    "UPDATE more_titles SET watchlisted_at = ? WHERE media_type = ? AND tmdb_id = ?",
  );
  const readWatchlist = database.prepare<[], TitleRow>(`
    SELECT tmdb_id, media_type, title, poster_url, backdrop_url, year, score FROM more_titles
    WHERE watchlisted_at IS NOT NULL ORDER BY watchlisted_at DESC LIMIT ${WATCHLIST_LIMIT}
  `);
  // Latest resume row per title, joined to its remembered metadata.
  const readContinue = database.prepare<[], TitleRow & ProgressRow>(`
    SELECT t.tmdb_id, t.media_type, t.title, t.poster_url, t.backdrop_url, t.year, t.score,
      r.season, r.episode, r.position_seconds, r.duration_seconds, r.updated_at
    FROM more_playback_resume r
    JOIN more_titles t ON t.media_type = r.media_type AND t.tmdb_id = r.tmdb_id
    WHERE r.updated_at = (
      SELECT MAX(latest.updated_at) FROM more_playback_resume latest
      WHERE latest.media_type = r.media_type AND latest.tmdb_id = r.tmdb_id
    )
    ORDER BY r.updated_at DESC, r.rowid DESC LIMIT ${CONTINUE_LIMIT * 2}
  `);
  const readProgress = database.prepare<[string, number], ProgressRow>(`
    SELECT season, episode, position_seconds, duration_seconds, updated_at
    FROM more_playback_resume WHERE media_type = ? AND tmdb_id = ?
    ORDER BY updated_at DESC, rowid DESC LIMIT 2000
  `);
  const readHistory = database.prepare<
    [],
    {
      media_type: MoreMediaType;
      tmdb_id: number;
      title: string | null;
      watchlisted_at: string | null;
      completed_at: string | null;
      rating: number | null;
      max_ratio: number | null;
      max_position: number | null;
      finished: number | null;
      updated_at: string;
    }
  >(`
    SELECT r.media_type, r.tmdb_id, t.title, t.watchlisted_at, t.completed_at, t.rating,
      MAX(MIN(1.0, r.position_seconds / r.duration_seconds)) AS max_ratio,
      MAX(r.position_seconds) AS max_position,
      SUM(CASE WHEN r.position_seconds >= r.duration_seconds * ${MORE_FINISHED_RATIO} THEN 1 ELSE 0 END)
        AS finished,
      MAX(r.updated_at) AS updated_at
    FROM more_playback_resume r
    LEFT JOIN more_titles t ON t.media_type = r.media_type AND t.tmdb_id = r.tmdb_id
    GROUP BY r.media_type, r.tmdb_id
    UNION ALL
    SELECT t.media_type, t.tmdb_id, t.title, t.watchlisted_at, t.completed_at, t.rating, 0, 0, 0,
      COALESCE(t.completed_at, t.watchlisted_at, t.updated_at)
    FROM more_titles t
    WHERE (t.watchlisted_at IS NOT NULL OR t.completed_at IS NOT NULL OR t.rating IS NOT NULL)
      AND NOT EXISTS (
      SELECT 1 FROM more_playback_resume r WHERE r.media_type = t.media_type AND r.tmdb_id = t.tmdb_id
    )
    ORDER BY updated_at DESC LIMIT ${HISTORY_LIMIT}
  `);
  const remember = (title: MoreTitleSnapshot): void => {
    upsertTitle.run({
      type: title.type,
      id: title.id,
      title: title.title,
      posterUrl: title.posterUrl ?? null,
      backdropUrl: title.backdropUrl ?? null,
      year: title.year ?? null,
      score: title.score ?? null,
      updatedAt: new Date().toISOString(),
    });
  };
  const saveWatchlist = database.transaction((title: MoreTitleSnapshot, saved: boolean) => {
    remember(title);
    setWatchlisted.run(saved ? new Date().toISOString() : null, title.type, title.id);
  });

  const saveCompleted = database.transaction((title: MoreTitleSnapshot, completed: boolean) => {
    remember(title);
    const at = completed ? new Date().toISOString() : null;
    setCompleted.run(at, at, title.type, title.id);
  });

  return {
    getMoreLibrary: () => {
      const seen = new Set<string>();
      const continueWatching: MoreContinueItem[] = [];
      for (const row of readContinue.all()) {
        const key = `${row.media_type}:${row.tmdb_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // A finished movie leaves the row; a finished episode stays so the title can offer the next one.
        const finished = row.position_seconds >= row.duration_seconds * MORE_FINISHED_RATIO;
        if (finished && row.media_type === "MOVIE") continue;
        continueWatching.push({ item: toCatalogItem(row), ...toProgress(row) });
        if (continueWatching.length >= CONTINUE_LIMIT) break;
      }
      return {
        watchlist: readWatchlist.all().map(toCatalogItem),
        continueWatching,
        completed: readCompleted
          .all()
          .map((row) => ({ type: row.media_type, tmdbId: row.tmdb_id })),
      };
    },
    getMoreTitleProgress: (input) => {
      if (!Number.isInteger(input.tmdbId) || input.tmdbId <= 0)
        throw new Error("Invalid TMDB media ID.");
      return readProgress.all(input.type, input.tmdbId).map(toProgress);
    },
    setMoreWatchlist: (title, saved) => {
      const parsed = parseMoreTitleSnapshot(title);
      if (!parsed) throw new Error("Invalid More title.");
      saveWatchlist(parsed, saved);
    },
    setMoreRating: (title, rating) => {
      const parsed = parseMoreTitleSnapshot(title);
      if (!parsed) throw new Error("Invalid More title.");
      if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 10))
        throw new Error("Ratings run from 1 to 10.");
      database.transaction(() => {
        remember(parsed);
        setRating.run(rating ?? null, parsed.type, parsed.id);
      })();
    },
    getMoreRating: (ref) => readRating.get(ref.type, ref.tmdbId)?.rating ?? undefined,
    setMoreCompleted: (title, completed) => {
      const parsed = parseMoreTitleSnapshot(title);
      if (!parsed) throw new Error("Invalid More title.");
      saveCompleted(parsed, completed);
    },
    rememberMoreTitle: (title) => {
      const parsed = parseMoreTitleSnapshot(title);
      if (!parsed) throw new Error("Invalid More title.");
      remember(parsed);
    },
    listMoreHistory: () =>
      readHistory.all().map((row) => ({
        type: row.media_type,
        tmdbId: row.tmdb_id,
        title: row.title ?? undefined,
        watchlisted: row.watchlisted_at !== null,
        maxRatio: row.max_ratio ?? 0,
        maxPositionSeconds: row.max_position ?? 0,
        finishedEpisodes: row.finished ?? 0,
        updatedAt: row.updated_at,
        trackerStatus: row.completed_at ? ("completed" as const) : undefined,
        rating: row.rating ?? undefined,
      })),
  };
}

function toCatalogItem(row: TitleRow): MoreCatalogItem {
  const path = row.media_type === "MOVIE" ? "movie" : "tv";
  return {
    id: row.tmdb_id,
    type: row.media_type,
    title: row.title,
    posterUrl: row.poster_url ?? undefined,
    backdropUrl: row.backdrop_url ?? undefined,
    year: row.year ?? undefined,
    score: row.score ?? undefined,
    genres: [],
    siteUrl: `https://www.themoviedb.org/${path}/${row.tmdb_id}`,
  };
}

function toProgress(row: ProgressRow): MoreTitleProgress {
  return {
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    updatedAt: row.updated_at,
  };
}
