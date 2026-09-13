import type Database from "better-sqlite3";
import {
  normalizeActivityInput,
  type LocalActivity,
  type RecordActivityInput,
} from "../../shared/activity";

export interface ActivityRepository {
  recordActivity(input: RecordActivityInput, owner?: number): LocalActivity;
  listActivity(owner?: number): LocalActivity[];
  pendingActivity(owner: number): LocalActivity[];
  acknowledgeActivity(owner: number, mediaId: number, progress: number, error?: string): void;
}

interface Row {
  owner: number;
  media_json: string;
  unit: number;
  state: "started" | "completed";
  chapter_id: string | null;
  completed: number;
  synced: number;
  updated_at: string;
  error: string | null;
}

export function createActivityRepository(db: Database.Database): ActivityRepository {
  db.exec(`CREATE TABLE IF NOT EXISTS local_activity_v1 (
    owner INTEGER NOT NULL, media_id INTEGER NOT NULL, media_json TEXT NOT NULL,
    unit REAL NOT NULL, state TEXT NOT NULL, chapter_id TEXT, completed INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, error TEXT,
    PRIMARY KEY(owner, media_id)
  );
  INSERT OR IGNORE INTO app_meta(key, value) VALUES ('activity.schema', '1');`);
  const map = (row: Row): LocalActivity => ({
    media: JSON.parse(row.media_json) as LocalActivity["media"],
    unit: row.unit,
    state: row.state,
    chapterId: row.chapter_id ?? undefined,
    completedProgress: row.completed,
    updatedAt: row.updated_at,
    syncStatus:
      row.owner === 0
        ? "local"
        : row.completed > row.synced
          ? "pending"
          : row.completed > 0
            ? "synced"
            : "local",
    syncError: row.error ?? undefined,
  });
  const record = db.transaction((raw: RecordActivityInput, owner = 0) => {
    const input = normalizeActivityInput(raw);
    const updatedAt = new Date().toISOString();
    const checkpoint = input.checkpoint;
    if (checkpoint && "episode" in checkpoint) {
      db.prepare(
        `INSERT INTO playback_resume (anilist_id, episode, position_seconds, duration_seconds, updated_at)
        VALUES (@aniListId, @episode, @positionSeconds, @durationSeconds, @updatedAt)
        ON CONFLICT(anilist_id) DO UPDATE SET episode=excluded.episode, position_seconds=excluded.position_seconds, duration_seconds=excluded.duration_seconds, updated_at=excluded.updated_at`,
      ).run({ ...checkpoint, updatedAt });
    } else if (checkpoint) {
      db.prepare(
        `INSERT INTO manga_reading_resume (anilist_id, chapter_id, chapter_number, progress, updated_at)
        VALUES (@aniListId, @chapterId, @chapterNumber, @progress, @updatedAt)
        ON CONFLICT(anilist_id) DO UPDATE SET chapter_id=excluded.chapter_id, chapter_number=excluded.chapter_number, progress=excluded.progress, updated_at=excluded.updated_at`,
      ).run({ ...checkpoint, chapterNumber: checkpoint.chapterNumber ?? null, updatedAt });
    }
    db.prepare(
      `INSERT INTO local_activity_v1(owner,media_id,media_json,unit,state,chapter_id,completed,updated_at)
      VALUES (@owner,@id,@media,@unit,@state,@chapter,@completed,@updated)
      ON CONFLICT(owner,media_id) DO UPDATE SET media_json=excluded.media_json,unit=excluded.unit,state=excluded.state,chapter_id=excluded.chapter_id,completed=MAX(local_activity_v1.completed,excluded.completed),updated_at=excluded.updated_at`,
    ).run({
      owner,
      id: input.media.id,
      media: JSON.stringify(input.media),
      unit: input.unit,
      state: input.state,
      chapter: input.chapterId ?? null,
      completed: input.state === "completed" ? Math.floor(input.unit) : 0,
      updated: new Date().toISOString(),
    });
    if (input.state === "completed" && input.media.type === "ANIME")
      db.prepare("DELETE FROM playback_resume WHERE anilist_id=? AND episode=?").run(
        input.media.id,
        input.unit,
      );
    if (input.state === "completed" && input.media.type === "MANGA" && input.chapterId)
      db.prepare(
        `INSERT INTO manga_reading_resume (anilist_id, chapter_id, chapter_number, progress, updated_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(anilist_id) DO UPDATE SET progress=1 WHERE chapter_id=excluded.chapter_id`,
      ).run(input.media.id, input.chapterId, input.unit, updatedAt);
    return map(
      db
        .prepare<[number, number], Row>(
          "SELECT * FROM local_activity_v1 WHERE owner=? AND media_id=?",
        )
        .get(owner, input.media.id)!,
    );
  });
  return {
    recordActivity: record,
    listActivity: (owner = 0) =>
      db
        .prepare<[number], Row>(
          "SELECT * FROM local_activity_v1 WHERE owner=0 OR owner=? ORDER BY updated_at DESC LIMIT 100",
        )
        .all(owner)
        .map(map),
    pendingActivity: (owner) =>
      db
        .prepare<[number], Row>(
          "SELECT * FROM local_activity_v1 WHERE owner=? AND completed>synced ORDER BY updated_at LIMIT 25",
        )
        .all(owner)
        .map(map),
    acknowledgeActivity: (owner, mediaId, progress, error) => {
      if (error)
        db.prepare("UPDATE local_activity_v1 SET error=? WHERE owner=? AND media_id=?").run(
          error.slice(0, 500),
          owner,
          mediaId,
        );
      else
        db.prepare(
          "UPDATE local_activity_v1 SET synced=MAX(synced,?),error=NULL WHERE owner=? AND media_id=?",
        ).run(progress, owner, mediaId);
    },
  };
}
