import { expect, it, vi } from "vitest";
import { createReaderSettingsSession } from "../../src/renderer/src/reader-settings-session";
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from "../../src/shared/reader-settings";

it("keeps reading available on load failure and preserves unsaved settings for retry", async () => {
  const api = {
    getReaderSettings: vi.fn(async (): Promise<ReaderSettings> => {
      throw new Error("disk");
    }),
    saveReaderSettings: vi.fn(async (value: ReaderSettings) => value),
  };
  const session = createReaderSettingsSession(api);
  await session.load();
  expect(session.getSnapshot()).toMatchObject({ loaded: true, settings: DEFAULT_READER_SETTINGS });
  expect(session.getSnapshot().error).toContain("defaults");
  const changed = { ...DEFAULT_READER_SETTINGS, width: 720 } as const;
  api.saveReaderSettings.mockRejectedValueOnce(new Error("disk full"));
  await session.save(changed);
  expect(session.getSnapshot().settings).toEqual(changed);
  expect(session.getSnapshot().error).toContain("not saved");
  await session.retry();
  expect(api.saveReaderSettings).toHaveBeenLastCalledWith(changed);
  expect(session.getSnapshot().error).toBeUndefined();
});

it("ignores late settings reads and saves after disposal", async () => {
  let finish: (settings: ReaderSettings) => void = () => undefined;
  const session = createReaderSettingsSession({
    getReaderSettings: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    saveReaderSettings: async (value) => value,
  });
  const pending = session.load();
  session.dispose();
  finish({ ...DEFAULT_READER_SETTINGS, width: 720 });
  await pending;
  expect(session.getSnapshot().loaded).toBe(false);
});
