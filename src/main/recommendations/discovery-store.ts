import type Database from "better-sqlite3";
import type {
  RecommendationEvent,
  RecommendationItemFeatures,
  RecommendationResult,
} from "../../shared/recommendations";

export interface DiscoveryStore {
  features(ids: number[]): RecommendationItemFeatures[];
  saveFeatures(items: RecommendationItemFeatures[]): void;
  events(owner: number): RecommendationEvent[];
  feedback(
    owner: number,
    item: RecommendationResult,
    action: "dismiss" | "undo" | "explore",
    now: number,
  ): void;
  impression(
    owner: number,
    requestId: string,
    item: RecommendationResult,
    position: number,
    now: number,
  ): void;
}

export function createDiscoveryStore(db: Database.Database): DiscoveryStore {
  // Synthetic preview history is intentionally never migrated into this live store.
  db.exec(`CREATE TABLE IF NOT EXISTS discovery_features_v1 (
    media_id INTEGER PRIMARY KEY, features TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discovery_feedback_v1 (
    owner INTEGER NOT NULL, media_id INTEGER NOT NULL, media_type TEXT NOT NULL,
    dismissed INTEGER NOT NULL DEFAULT 0, explored_at INTEGER, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner, media_id)
  );
  CREATE TABLE IF NOT EXISTS discovery_impressions_v1 (
    owner INTEGER NOT NULL, request_id TEXT NOT NULL, media_id INTEGER NOT NULL,
    position INTEGER NOT NULL, shown_at INTEGER NOT NULL,
    PRIMARY KEY(owner, request_id, media_id)
  );
  INSERT OR IGNORE INTO app_meta(key, value) VALUES ('discovery.schema', '1');`);
  return {
    features(ids) {
      const read = db.prepare<[number], { features: string }>(
        "SELECT features FROM discovery_features_v1 WHERE media_id=?",
      );
      return [...new Set(ids)].slice(0, 120).flatMap((id) => {
        const row = read.get(id);
        if (!row) return [];
        try {
          return [JSON.parse(row.features) as RecommendationItemFeatures];
        } catch {
          return [];
        }
      });
    },
    saveFeatures(items) {
      db.transaction(() => {
        const write = db.prepare(
          "INSERT INTO discovery_features_v1 VALUES (?, ?, ?) ON CONFLICT(media_id) DO UPDATE SET features=excluded.features, updated_at=excluded.updated_at",
        );
        for (const item of items.slice(0, 120))
          write.run(item.anilistId, JSON.stringify(item), item.updatedAt);
        db.prepare(
          "DELETE FROM discovery_features_v1 WHERE media_id NOT IN (SELECT media_id FROM discovery_features_v1 ORDER BY updated_at DESC LIMIT 500)",
        ).run();
      })();
    },
    events(owner) {
      const rows = db
        .prepare<
          [number],
          {
            media_id: number;
            media_type: RecommendationEvent["mediaType"];
            dismissed: number;
            explored_at: number | null;
            updated_at: number;
          }
        >("SELECT * FROM discovery_feedback_v1 WHERE owner=? ORDER BY updated_at DESC LIMIT 500")
        .all(owner);
      return rows.flatMap((row) => {
        const events: RecommendationEvent[] = [];
        if (row.explored_at)
          events.push({
            anilistId: row.media_id,
            mediaType: row.media_type,
            occurredAt: row.explored_at,
            eventType: "explored",
            source: "detail",
          });
        if (row.dismissed)
          events.push({
            anilistId: row.media_id,
            mediaType: row.media_type,
            occurredAt: row.updated_at,
            eventType: "dismissed",
            source: "detail",
          });
        return events;
      });
    },
    feedback(owner, item, action, now) {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO discovery_feedback_v1 VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner, media_id) DO UPDATE SET
          dismissed=CASE WHEN ?='explore' THEN dismissed ELSE excluded.dismissed END,
          explored_at=COALESCE(excluded.explored_at, explored_at), updated_at=excluded.updated_at`,
        ).run(
          owner,
          item.anilistId,
          item.mediaType,
          action === "dismiss" ? 1 : 0,
          action === "explore" ? now : null,
          now,
          action,
        );
        db.prepare(
          "DELETE FROM discovery_feedback_v1 WHERE owner=? AND media_id NOT IN (SELECT media_id FROM discovery_feedback_v1 WHERE owner=? ORDER BY updated_at DESC LIMIT 500)",
        ).run(owner, owner);
      })();
    },
    impression(owner, requestId, item, position, now) {
      db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO discovery_impressions_v1 VALUES (?, ?, ?, ?, ?)").run(
          owner,
          requestId,
          item.anilistId,
          position,
          now,
        );
        db.prepare(
          "DELETE FROM discovery_impressions_v1 WHERE rowid NOT IN (SELECT rowid FROM discovery_impressions_v1 ORDER BY shown_at DESC LIMIT 5000)",
        ).run();
      })();
    },
  };
}
