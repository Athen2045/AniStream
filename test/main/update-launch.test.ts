import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { UpdateLaunch } from "../../src/main/update-launch";
import {
  createUpdateLaunchStore,
  parseLaunchState,
  type UpdateLaunchState,
} from "../../src/main/update-launch-store";

afterEach(() => vi.useRealTimers());
function memory(initial: UpdateLaunchState = { attempts: 0 }) {
  let state = initial;
  return {
    read: vi.fn(() => state),
    write: vi.fn((value: UpdateLaunchState) => {
      state = value;
    }),
  };
}
it("warns only after two incomplete attempts with a known different stable version", () => {
  const store = memory({ lastGoodVersion: "0.1.3", attempts: 0 });
  expect(new UpdateLaunch(store, "0.1.4", true).recovery).toBeUndefined();
  expect(new UpdateLaunch(store, "0.1.4", true).recovery).toBeUndefined();
  expect(new UpdateLaunch(store, "0.1.4", true).recovery).toMatchObject({
    lastGoodVersion: "0.1.3",
  });
  expect(store.read().attempts).toBe(3);
  expect(new UpdateLaunch(store, "0.1.5", true).recovery).toBeUndefined();
  expect(store.read().attempts).toBe(1);
});
it("never invents recovery for fresh installs or the already stable version", () => {
  for (const initial of [{ attempts: 0 }, { lastGoodVersion: "0.1.3", attempts: 0 }]) {
    const store = memory(initial);
    for (let i = 0; i < 5; i++)
      expect(new UpdateLaunch(store, "0.1.3", true).recovery).toBeUndefined();
  }
});
it("marks stable only after eight healthy seconds and retains this launch's guidance", async () => {
  vi.useFakeTimers();
  const store = memory({ lastGoodVersion: "0.1.3", pendingVersion: "0.1.4", attempts: 2 });
  const launch = new UpdateLaunch(store, "0.1.4", true);
  launch.rendererLoaded(() => true);
  await vi.advanceTimersByTimeAsync(7999);
  expect(store.read().lastGoodVersion).toBe("0.1.3");
  await vi.advanceTimersByTimeAsync(1);
  expect(store.read()).toEqual({ lastGoodVersion: "0.1.4", attempts: 0 });
  expect(launch.recovery?.lastGoodVersion).toBe("0.1.3");
  launch.rendererLoaded(() => true);
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(2);
});
it.each(["cancel", "dispose", "unhealthy"])("does not confirm startup after %s", async (mode) => {
  vi.useFakeTimers();
  const store = memory();
  const launch = new UpdateLaunch(store, "0.1.3", true);
  launch.rendererLoaded(() => mode !== "unhealthy");
  if (mode === "cancel") launch.cancelTimer();
  if (mode === "dispose") launch.dispose();
  await vi.advanceTimersByTimeAsync(8000);
  expect(store.write).toHaveBeenCalledTimes(1);
  if (mode === "cancel") {
    launch.rendererLoaded(() => true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(store.read()).toEqual({ lastGoodVersion: "0.1.3", attempts: 0 });
  }
});
it("ignores unavailable storage and disables bookkeeping on unsupported builds", async () => {
  vi.useFakeTimers();
  const store = {
    read: vi.fn(() => {
      throw new Error("disk");
    }),
    write: vi.fn(() => {
      throw new Error("disk");
    }),
  };
  const disabled = new UpdateLaunch(store, "0.1.3", false);
  disabled.rendererLoaded(() => true);
  expect(store.read).not.toHaveBeenCalled();
  expect(store.write).not.toHaveBeenCalled();
  const enabled = new UpdateLaunch(store, "0.1.3", true);
  enabled.rendererLoaded(() => true);
  await vi.advanceTimersByTimeAsync(8000);
  expect(enabled.recovery).toBeUndefined();
});
it("validates and atomically persists a dedicated launch state", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const store = createUpdateLaunchStore(db);
    expect(store.read()).toEqual({ attempts: 0 });
    const state = { lastGoodVersion: "0.1.3", pendingVersion: "0.1.4", attempts: 2 };
    store.write(state);
    expect(createUpdateLaunchStore(db).read()).toEqual(state);
    expect(() => store.write({ ...state, attempts: 4 })).toThrow();
    expect(store.read()).toEqual(state);
    db.prepare("UPDATE app_meta SET value=? WHERE key=?").run("{bad", "update.launch.v1");
    expect(() => store.read()).toThrow();
    expect(() => new UpdateLaunch(store, "0.1.4", true)).not.toThrow();
    expect(store.read()).toMatchObject({ pendingVersion: "0.1.4", attempts: 1 });
  } finally {
    db.close();
  }
});
it.each([
  null,
  [],
  {},
  { attempts: -1 },
  { attempts: 2 },
  { attempts: 0, lastGoodVersion: "evil" },
  { attempts: 1, pendingVersion: "v0.1.3" },
])("rejects malformed stored state %#", (state) => {
  expect(() => parseLaunchState(state)).toThrow();
});
