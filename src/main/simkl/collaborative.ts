import type Database from "better-sqlite3";
import type { MoreMediaType } from "../../shared/contracts";
import type { RecommendationEdge, RecommendationItemFeatures } from "../../shared/recommendations";
import { sharedGenres } from "../tmdb";

/**
 * Collaborative recommendations from Simkl: each title page lists `users_recommendations`, what
 * that title's own viewers also watched. Entries carry only Simkl IDs, so each is resolved once
 * through its own (CDN-cached, token-free) title page to a TMDB ID and card features, and cached.
 */
export interface SimklTitle {
  type: MoreMediaType;
  simklId: number;
  /** Absent when Simkl has no TMDB ID for the title; such titles cannot enter More. */
  features?: RecommendationItemFeatures;
  /** Simkl IDs of titles this title's viewers also watched, best first. */
  recommendations: Array<{ type: MoreMediaType; simklId: number }>;
}

export interface SimklCatalogStore {
  get(type: MoreMediaType, simklId: number): { title: SimklTitle; updatedAt: number } | undefined;
  save(title: SimklTitle, now: number): void;
}

const MAX_RECOMMENDATIONS = 10;
const MAX_ROWS = 5_000;
const POSTER_PATH = /^\d{1,4}\/[0-9a-f]{6,40}$/;

export function createSimklCatalogStore(db: Database.Database): SimklCatalogStore {
  db.exec(`CREATE TABLE IF NOT EXISTS simkl_catalog_v1 (
    media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
    simkl_id INTEGER NOT NULL CHECK (simkl_id > 0),
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (media_type, simkl_id)
  );`);
  const read = db.prepare<[string, number], { payload: string; updated_at: number }>(
    "SELECT payload, updated_at FROM simkl_catalog_v1 WHERE media_type=? AND simkl_id=?",
  );
  return {
    get(type, simklId) {
      const row = read.get(type, simklId);
      if (!row) return undefined;
      try {
        return { title: JSON.parse(row.payload) as SimklTitle, updatedAt: row.updated_at };
      } catch {
        return undefined;
      }
    },
    save(title, now) {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO simkl_catalog_v1 VALUES (?, ?, ?, ?)
           ON CONFLICT(media_type, simkl_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
        ).run(title.type, title.simklId, JSON.stringify(title), now);
        db.prepare(
          `DELETE FROM simkl_catalog_v1 WHERE rowid NOT IN (SELECT rowid FROM simkl_catalog_v1 ORDER BY updated_at DESC LIMIT ${MAX_ROWS})`,
        ).run();
      })();
    },
  };
}

/** Parses a Simkl `/movies/{id}` or `/tv/{id}` title page. */
export function parseSimklTitle(
  payload: unknown,
  type: MoreMediaType,
  simklId: number,
  now: number,
): SimklTitle {
  if (!isRecord(payload)) throw new Error("Simkl returned an invalid title page.");
  const ids = isRecord(payload.ids) ? payload.ids : {};
  const tmdb = String(ids.tmdb ?? "");
  const tmdbId = /^\d{1,9}$/.test(tmdb) && Number(tmdb) > 0 ? Number(tmdb) : undefined;
  const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 300) : "";
  const ratings =
    isRecord(payload.ratings) && isRecord(payload.ratings.simkl) ? payload.ratings.simkl : {};
  const released =
    typeof payload.released === "string"
      ? payload.released
      : typeof payload.first_aired === "string"
        ? payload.first_aired
        : undefined;
  const language =
    typeof payload.language === "string" && /^[A-Za-z]{2,3}$/.test(payload.language)
      ? payload.language.toLowerCase()
      : undefined;
  const features: RecommendationItemFeatures | undefined =
    tmdbId && title
      ? {
          anilistId: tmdbId,
          mediaType: type,
          normalizedTitle: title,
          coverUrl:
            typeof payload.poster === "string" && POSTER_PATH.test(payload.poster)
              ? `https://simkl.in/posters/${payload.poster}_m.webp`
              : undefined,
          releaseDate:
            released && /^\d{4}-\d{2}-\d{2}/.test(released) ? released.slice(0, 10) : undefined,
          titleTokens: [],
          synonyms: [],
          genres: Array.isArray(payload.genres)
            ? sharedGenres(
                payload.genres.filter((genre): genre is string => typeof genre === "string"),
              ).slice(0, 8)
            : [],
          tags: [],
          creators: [],
          averageScore:
            typeof ratings.rating === "number" ? Math.round(ratings.rating * 10) : undefined,
          popularity: typeof ratings.votes === "number" ? ratings.votes : undefined,
          origin: language,
          isAdult: false,
          updatedAt: now,
        }
      : undefined;
  const recommendations = (
    Array.isArray(payload.users_recommendations) ? payload.users_recommendations : []
  )
    .flatMap((entry): SimklTitle["recommendations"] => {
      if (!isRecord(entry) || !isRecord(entry.ids)) return [];
      const id = entry.ids.simkl;
      const kind = entry.type === "movie" ? "MOVIE" : entry.type === "tv" ? "TV" : undefined;
      return kind && typeof id === "number" && Number.isInteger(id) && id > 0
        ? [{ type: kind, simklId: id }]
        : [];
    })
    .slice(0, MAX_RECOMMENDATIONS);
  return { type, simklId, features, recommendations };
}

/**
 * The collaborative edges for one of the viewer's titles from cache only: resolved neighbours
 * become graph edges (rank-weighted like TMDB's, but a step stronger since they come from real
 * co-watching) plus their card features. Undefined until the title page has been fetched.
 */
export function collaborativeEdges(
  store: SimklCatalogStore,
  seed: { type: MoreMediaType; simklId: number },
): { edges: RecommendationEdge[]; features: RecommendationItemFeatures[] } | undefined {
  const cached = store.get(seed.type, seed.simklId);
  if (!cached) return undefined;
  const features = cached.title.recommendations.flatMap(
    (ref) => store.get(ref.type, ref.simklId)?.title.features ?? [],
  );
  return {
    features,
    edges: features.map((row, index) => ({
      id: row.anilistId,
      mediaType: row.mediaType,
      rating: 20 - index,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
