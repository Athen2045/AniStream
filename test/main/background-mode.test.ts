import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { decideClose, shouldQuitWhenIdle } from "../../src/main/background-mode";
import { createBackgroundPreferencesStore } from "../../src/main/background-preferences-store";
import {
  DEFAULT_BACKGROUND_PREFERENCES,
  parseBackgroundPreferences,
  type BackgroundPreferences,
} from "../../src/shared/background";

const close = (
  preferences: Partial<BackgroundPreferences>,
  activeDownloads = 0,
  extra: { quitting?: boolean; platform?: NodeJS.Platform } = {},
) =>
  decideClose({
    quitting: extra.quitting ?? false,
    platform: extra.platform ?? "win32",
    preferences: { ...DEFAULT_BACKGROUND_PREFERENCES, ...preferences },
    activeDownloads,
  });

describe("background mode", () => {
  it("quits on close by default, as before", () => {
    expect(close({})).toBe("close");
  });

  it("asks only when downloads are running and nothing is remembered", () => {
    expect(close({}, 2)).toBe("ask");
    expect(close({ whileDownloading: "background" }, 2)).toBe("hide");
    expect(close({ whileDownloading: "quit" }, 2)).toBe("close");
  });

  it("keeps running when the setting is on, downloads or not", () => {
    expect(close({ keepRunning: true })).toBe("hide");
    expect(close({ keepRunning: true, whileDownloading: "quit" }, 3)).toBe("hide");
  });

  it("never stops a real quit, and leaves macOS as it is", () => {
    expect(close({ keepRunning: true }, 3, { quitting: true })).toBe("close");
    expect(close({ keepRunning: true }, 3, { platform: "darwin" })).toBe("close");
  });

  it("quits from the tray once the downloads it stayed for are done", () => {
    const idle = { hiddenForDownloads: true, windowVisible: false, activeDownloads: 0 };
    expect(shouldQuitWhenIdle(idle)).toBe(true);
    expect(shouldQuitWhenIdle({ ...idle, activeDownloads: 1 })).toBe(false);
    // Reopened meanwhile, or kept running by the setting: stays.
    expect(shouldQuitWhenIdle({ ...idle, windowVisible: true })).toBe(false);
    expect(shouldQuitWhenIdle({ ...idle, hiddenForDownloads: false })).toBe(false);
  });

  it("stores only valid preferences, defaulting to quit-and-ask", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const store = createBackgroundPreferencesStore(db);
    expect(store.read()).toEqual({ keepRunning: false, whileDownloading: "ask" });
    expect(store.write({ keepRunning: true, whileDownloading: "quit" })).toEqual({
      keepRunning: true,
      whileDownloading: "quit",
    });
    expect(store.read()).toEqual({ keepRunning: true, whileDownloading: "quit" });
    expect(() =>
      store.write({
        keepRunning: true,
        whileDownloading: "later",
      } as unknown as BackgroundPreferences),
    ).toThrow();
    db.prepare("UPDATE app_meta SET value='garbage'").run();
    expect(store.read()).toEqual(DEFAULT_BACKGROUND_PREFERENCES);
    expect(
      parseBackgroundPreferences({ keepRunning: "yes", whileDownloading: "ask" }),
    ).toBeUndefined();
  });
});
