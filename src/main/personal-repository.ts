import type Database from "better-sqlite3";
import type { ReleaseAcknowledgement } from "../shared/personal-library";

export interface PersonalRepository {
  getReleaseAcknowledgements(): ReleaseAcknowledgement[];
  acknowledgeRelease(input: ReleaseAcknowledgement): void;
}

export function validReleaseAcknowledgement(input: ReleaseAcknowledgement): boolean {
  return (
    /^(ANIME:[1-9]\d{0,9}|MANGA:[1-9]\d{0,9}:[a-z]{2,3}(?:-[a-z]{2,4})?)$/.test(input.key) &&
    Number.isFinite(input.unit) &&
    input.unit > 0 &&
    input.unit <= 1_000_000
  );
}

export function createPersonalRepository(database: Database.Database): PersonalRepository {
  database.exec(`
    CREATE TABLE IF NOT EXISTS personal_schema (module TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS release_acknowledgements (
      key TEXT PRIMARY KEY,
      unit REAL NOT NULL CHECK (unit > 0),
      updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO personal_schema (module, version) VALUES ('releases', 1);
  `);
  const read = database.prepare<[], ReleaseAcknowledgement>(
    "SELECT key, unit FROM release_acknowledgements ORDER BY updated_at DESC LIMIT 1000",
  );
  const write = database.prepare(
    "INSERT INTO release_acknowledgements (key, unit, updated_at) VALUES (@key, @unit, @updatedAt) ON CONFLICT(key) DO UPDATE SET unit = MAX(unit, excluded.unit), updated_at = excluded.updated_at",
  );
  const prune = database.prepare(
    "DELETE FROM release_acknowledgements WHERE key NOT IN (SELECT key FROM release_acknowledgements ORDER BY updated_at DESC LIMIT 1000)",
  );
  const acknowledge = database.transaction((input: ReleaseAcknowledgement) => {
    write.run({ ...input, updatedAt: Date.now() });
    prune.run();
  });
  return {
    getReleaseAcknowledgements: () => read.all(),
    acknowledgeRelease: (input) => {
      if (!validReleaseAcknowledgement(input)) throw new Error("Invalid release acknowledgement.");
      acknowledge(input);
    },
  };
}
