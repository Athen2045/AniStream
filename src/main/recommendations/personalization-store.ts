import type Database from "better-sqlite3";
import type {
  PersonalizationSection,
  TitleFeedbackRef,
  TitleFeedbackValue,
  TimeToPlaySummary,
} from "../../shared/contracts";

export interface TitleFeedbackRow extends TitleFeedbackRef {
  value: Exclude<TitleFeedbackValue, null>;
  updatedAt: number;
}

/**
 * Local personalization state: "Interested" / "Not interested" on title pages, the "learn from my
 * activity" switch, and time-to-play measurements. Everything stays in this database.
 */
export interface PersonalizationStore {
  feedback(): TitleFeedbackRow[];
  getFeedback(ref: TitleFeedbackRef): TitleFeedbackValue;
  setFeedback(ref: TitleFeedbackRef, value: TitleFeedbackValue, now: number): void;
  /** On unless the viewer turned it off. */
  activitySignals(): boolean;
  /** Turning it off also deletes the measurements collected so far. */
  setActivitySignals(on: boolean): void;
  recordTimeToPlay(section: PersonalizationSection, seconds: number, now: number): void;
  timeToPlay(): TimeToPlaySummary[];
}

const ACTIVITY_KEY = "personalization.activity-signals.v1";
const MAX_FEEDBACK = 5_000;
const MAX_MEASUREMENTS = 300;
/** Median of the most recent sessions per section. */
const SUMMARY_SAMPLES = 20;
const SECTIONS: PersonalizationSection[] = ["ANIME", "MANGA", "MORE"];

export function createPersonalizationStore(db: Database.Database): PersonalizationStore {
  db.exec(`CREATE TABLE IF NOT EXISTS title_feedback_v1 (
    media_type TEXT NOT NULL CHECK (media_type IN ('ANIME', 'MANGA', 'MOVIE', 'TV')),
    media_id INTEGER NOT NULL CHECK (media_id > 0),
    value TEXT NOT NULL CHECK (value IN ('interested', 'not-interested')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (media_type, media_id)
  );
  CREATE TABLE IF NOT EXISTS time_to_play_v1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL CHECK (section IN ('ANIME', 'MANGA', 'MORE')),
    seconds REAL NOT NULL CHECK (seconds >= 0),
    recorded_at INTEGER NOT NULL
  );`);
  type Row = {
    media_type: TitleFeedbackRef["type"];
    media_id: number;
    value: "interested" | "not-interested";
    updated_at: number;
  };
  const readMeta = db.prepare<[string], { value: string }>(
    "SELECT value FROM app_meta WHERE key=?",
  );
  const writeMeta = db.prepare(
    "INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  return {
    feedback: () =>
      db
        .prepare<[], Row>(
          `SELECT * FROM title_feedback_v1 ORDER BY updated_at DESC LIMIT ${MAX_FEEDBACK}`,
        )
        .all()
        .map((row) => ({
          type: row.media_type,
          id: row.media_id,
          value: row.value,
          updatedAt: row.updated_at,
        })),
    getFeedback: (ref) =>
      db
        .prepare<[string, number], { value: "interested" | "not-interested" }>(
          "SELECT value FROM title_feedback_v1 WHERE media_type=? AND media_id=?",
        )
        .get(ref.type, ref.id)?.value ?? null,
    setFeedback: (ref, value, now) => {
      if (value === null)
        db.prepare("DELETE FROM title_feedback_v1 WHERE media_type=? AND media_id=?").run(
          ref.type,
          ref.id,
        );
      else
        db.prepare(
          `INSERT INTO title_feedback_v1 VALUES (?, ?, ?, ?)
           ON CONFLICT(media_type, media_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        ).run(ref.type, ref.id, value, now);
    },
    activitySignals: () => readMeta.get(ACTIVITY_KEY)?.value !== "0",
    setActivitySignals: (on) =>
      db.transaction(() => {
        writeMeta.run(ACTIVITY_KEY, on ? "1" : "0");
        if (!on) db.prepare("DELETE FROM time_to_play_v1").run();
      })(),
    recordTimeToPlay: (section, seconds, now) =>
      db.transaction(() => {
        db.prepare(
          "INSERT INTO time_to_play_v1 (section, seconds, recorded_at) VALUES (?, ?, ?)",
        ).run(section, seconds, now);
        db.prepare(
          `DELETE FROM time_to_play_v1 WHERE id NOT IN (SELECT id FROM time_to_play_v1 ORDER BY id DESC LIMIT ${MAX_MEASUREMENTS})`,
        ).run();
      })(),
    timeToPlay: () =>
      SECTIONS.flatMap((section) => {
        const values = db
          .prepare<[string], { seconds: number }>(
            `SELECT seconds FROM time_to_play_v1 WHERE section=? ORDER BY id DESC LIMIT ${SUMMARY_SAMPLES}`,
          )
          .all(section)
          .map((row) => row.seconds)
          .sort((a, b) => a - b);
        if (!values.length) return [];
        const middle = Math.floor(values.length / 2);
        const median =
          values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
        return [{ section, medianSeconds: Math.round(median), samples: values.length }];
      }),
  };
}
