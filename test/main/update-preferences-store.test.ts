import { expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import {
  DEFAULT_UPDATE_PREFERENCES,
  parseUpdatePreferences,
} from "../../src/main/update-preferences-store";

it("defaults to background download with install on click", () => {
  const db = openAppDatabase(":memory:");
  expect(db.updatePreferences.read()).toEqual({ autoDownload: true, installOnQuit: false });
  expect(DEFAULT_UPDATE_PREFERENCES).toEqual({ autoDownload: true, installOnQuit: false });
  db.close();
});

it("persists preferences and rejects malformed values", () => {
  const db = openAppDatabase(":memory:");
  db.updatePreferences.write({ autoDownload: false, installOnQuit: true });
  expect(db.updatePreferences.read()).toEqual({ autoDownload: false, installOnQuit: true });
  expect(() =>
    db.updatePreferences.write({ autoDownload: "no" as never, installOnQuit: true }),
  ).toThrow();
  expect(db.updatePreferences.read()).toEqual({ autoDownload: false, installOnQuit: true });
  db.close();
});

it.each([null, [], { autoDownload: true }, { autoDownload: 1, installOnQuit: false }])(
  "rejects stored value %j",
  (value) => {
    expect(() => parseUpdatePreferences(value)).toThrow();
  },
);
