import type Database from "better-sqlite3";
import type { MoreMediaType } from "../../shared/contracts";
import type { RecommendationItemFeatures } from "../../shared/recommendations";
import { itemKey } from "./hybrid";

/** Local cache of TMDB recommendation features and the viewer's More "Not interested" choices. */
export interface MoreDiscoveryStore {
  features(keys: string[]): RecommendationItemFeatures[];
  saveFeatures(items: RecommendationItemFeatures[]): void;
  dismissed(): Array<{ type: MoreMediaType; tmdbId: number; updatedAt: number }>;
  setDismissed(type: MoreMediaType, tmdbId: number, dismissed: boolean, now: number): void;
}

const MAX_READ = 2_000;
const MAX_WRITE = 1_000;
const MAX_ROWS = 3_000;
const MAX_DISMISSED = 500;

export function createMoreDiscoveryStore(db: Database.Database): MoreDiscoveryStore {
  db.exec(`CREATE TABLE IF NOT EXISTS more_discovery_features_v1 (
    item_key TEXT PRIMARY KEY, features TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS more_discovery_dismissed_v1 (
    media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
    tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (media_type, tmdb_id)
  );`);
  const read = db.prepare<[string], { features: string }>(
    "SELECT features FROM more_discovery_features_v1 WHERE item_key=?",
  );
  const parse = (text: string): RecommendationItemFeatures | undefined => {
    try {
      const value = JSON.parse(text) as RecommendationItemFeatures;
      return value.mediaType === "MOVIE" || value.mediaType === "TV" ? value : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    features(keys) {
      return [...new Set(keys)].slice(0, MAX_READ).flatMap((key) => {
        const row = read.get(key);
        return row ? (parse(row.features) ?? []) : [];
      });
    },
    saveFeatures(items) {
      db.transaction(() => {
        const write = db.prepare(
          "INSERT INTO more_discovery_features_v1 VALUES (?, ?, ?) ON CONFLICT(item_key) DO UPDATE SET features=excluded.features, updated_at=excluded.updated_at",
        );
        for (const item of items.slice(0, MAX_WRITE)) {
          if (item.mediaType !== "MOVIE" && item.mediaType !== "TV") continue;
          const key = itemKey(item);
          let row = item;
          if (!item.recommendations) {
            // A neighbor-only save must not erase a seed's cached edges, keywords, or people.
            const previous = read.get(key);
            const cached = previous ? parse(previous.features) : undefined;
            if (cached?.recommendations)
              row = {
                ...item,
                recommendations: cached.recommendations,
                tags: cached.tags,
                creators: cached.creators,
              };
          }
          write.run(key, JSON.stringify(row), row.updatedAt);
        }
        db.prepare(
          `DELETE FROM more_discovery_features_v1 WHERE item_key NOT IN (SELECT item_key FROM more_discovery_features_v1 ORDER BY updated_at DESC LIMIT ${MAX_ROWS})`,
        ).run();
      })();
    },
    dismissed() {
      return db
        .prepare<[], { media_type: MoreMediaType; tmdb_id: number; updated_at: number }>(
          `SELECT * FROM more_discovery_dismissed_v1 ORDER BY updated_at DESC LIMIT ${MAX_DISMISSED}`,
        )
        .all()
        .map((row) => ({ type: row.media_type, tmdbId: row.tmdb_id, updatedAt: row.updated_at }));
    },
    setDismissed(type, tmdbId, dismissed, now) {
      db.transaction(() => {
        if (!dismissed) {
          db.prepare(
            "DELETE FROM more_discovery_dismissed_v1 WHERE media_type=? AND tmdb_id=?",
          ).run(type, tmdbId);
          return;
        }
        db.prepare(
          "INSERT INTO more_discovery_dismissed_v1 VALUES (?, ?, ?) ON CONFLICT(media_type, tmdb_id) DO UPDATE SET updated_at=excluded.updated_at",
        ).run(type, tmdbId, now);
        db.prepare(
          `DELETE FROM more_discovery_dismissed_v1 WHERE rowid NOT IN (SELECT rowid FROM more_discovery_dismissed_v1 ORDER BY updated_at DESC LIMIT ${MAX_DISMISSED})`,
        ).run();
      })();
    },
  };
}
