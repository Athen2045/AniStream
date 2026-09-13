import { mkdtempSync, rmSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import { DEFAULT_READER_SETTINGS } from "../../src/shared/reader-settings";
import { createBoundedCache } from "../../src/main/anilist/cache";

it("persists global reader settings across reopen without changing title preferences", () => {
  const dir = mkdtempSync(join(tmpdir(), "anistream-reader-settings-"));
  const path = join(dir, "test.sqlite");
  let db = openAppDatabase(path);
  try {
    expect(db.getReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
    db.saveMangaReaderPreferences({
      aniListId: 1,
      translatedLanguage: "ja",
      preferredGroupId: "group-a",
    });
    const settings = { width: 720, fit: "original", quality: "data-saver" } as const;
    db.saveReaderSettings(settings);
    db.close();
    db = openAppDatabase(path);
    expect(db.getReaderSettings()).toEqual(settings);
    expect(db.getMangaReaderPreferences(1)).toMatchObject({
      translatedLanguage: "ja",
      preferredGroupId: "group-a",
    });
    expect(() => db.saveReaderSettings({ ...settings, width: NaN } as never)).toThrow();
    expect(db.getReaderSettings()).toEqual(settings);
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(path + suffix)) rmSync(path + suffix);
    rmdirSync(dir);
  }
});

it("rejects invalid reader settings and unexpected argument counts at IPC", () => {
  expect(ipcArgValidators["reader:settings"]([])).toEqual([]);
  for (const input of [
    null,
    {},
    { ...DEFAULT_READER_SETTINGS, width: 800 },
    { ...DEFAULT_READER_SETTINGS, quality: "url" },
  ])
    expect(() => ipcArgValidators["reader:save-settings"]([input])).toThrow();
  expect(() => ipcArgValidators["reader:settings"]([{}])).toThrow();
});

it("bounds image cache bytes, honors LRU and does not cache an oversized page", () => {
  const cache = createBoundedCache<ArrayBuffer>({
    maxEntries: 18,
    ttlMs: 60000,
    maxBytes: 8,
    sizeOf: (buffer) => buffer.byteLength,
  });
  cache.set("a", new ArrayBuffer(4));
  cache.set("b", new ArrayBuffer(4));
  cache.get("a");
  cache.set("c", new ArrayBuffer(4));
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")?.byteLength).toBe(4);
  cache.set("large", new ArrayBuffer(9));
  expect(cache.get("large")).toBeUndefined();
  expect(cache.get("c")?.byteLength).toBe(4);
});
