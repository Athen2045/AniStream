import type Database from "better-sqlite3";
import { stableVersion } from "./update-release";

export interface UpdateLaunchState {
  lastGoodVersion?: string;
  pendingVersion?: string;
  attempts: number;
}
export interface UpdateLaunchStore {
  read(): UpdateLaunchState;
  write(state: UpdateLaunchState): void;
}

export function parseLaunchState(value: unknown): UpdateLaunchState {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid launch state.");
  const state = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(state.attempts) ||
    (state.attempts as number) < 0 ||
    (state.attempts as number) > 3 ||
    (state.lastGoodVersion !== undefined &&
      stableVersion(state.lastGoodVersion) !== state.lastGoodVersion) ||
    (state.pendingVersion !== undefined &&
      stableVersion(state.pendingVersion) !== state.pendingVersion) ||
    (state.attempts !== 0 && state.pendingVersion === undefined)
  )
    throw new Error("Invalid launch state.");
  return {
    lastGoodVersion: state.lastGoodVersion as string | undefined,
    pendingVersion: state.pendingVersion as string | undefined,
    attempts: state.attempts as number,
  };
}

export function createUpdateLaunchStore(database: Database.Database): UpdateLaunchStore {
  const key = "update.launch.v1";
  return {
    read() {
      const row = database
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(key);
      return row ? parseLaunchState(JSON.parse(row.value)) : { attempts: 0 };
    },
    write(state) {
      const parsed = parseLaunchState(state);
      database
        .prepare(
          "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(parsed));
    },
  };
}
