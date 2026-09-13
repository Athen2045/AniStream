import { mkdtempSync, readdirSync, rmSync, rmdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { openAppDatabase, type AppDatabase } from "../../src/main/database";
import { createBackupService, type BackupFiles } from "../../src/main/backup-service";
import { readBackupFile, writeBackupFile } from "../../src/main/backup-files";
import { BACKUP_MAX_BYTES, parseLocalBackup } from "../../src/main/backup-validation";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import type { LocalBackup } from "../../src/shared/local-backup";

const databases: AppDatabase[] = [];
const directories: string[] = [];
function database(path = ":memory:"): AppDatabase {
  const db = openAppDatabase(path);
  databases.push(db);
  return db;
}
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "anistream-backup-test-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) {
    // Only these directly created test directories and their flat files are removed.
    for (const name of readdirSync(dir)) rmSync(join(dir, name));
    rmdirSync(dir);
  }
});
function seed(db: AppDatabase): void {
  db.recordActivity(
    {
      media: { id: 1, type: "ANIME", coverUrl: "", siteUrl: "", title: "Local Sky" },
      unit: 2,
      state: "completed",
    },
    42,
  );
  db.recordActivity(
    {
      media: { id: 1, type: "ANIME", coverUrl: "", siteUrl: "", title: "Local Sky" },
      unit: 3,
      state: "started",
      checkpoint: { aniListId: 1, episode: 3, positionSeconds: 90, durationSeconds: 1400 },
    },
    42,
  );
  db.recordActivity({
    media: { id: 2, type: "MANGA", coverUrl: "", siteUrl: "", title: "Local Garden" },
    unit: 1.5,
    chapterId: "chapter-2",
    state: "started",
    checkpoint: { aniListId: 2, chapterId: "chapter-2", chapterNumber: 1.5, progress: 0.4 },
  });
  db.saveMangaReaderPreferences({
    aniListId: 2,
    translatedLanguage: "ja",
    preferredGroupId: "group-2",
  });
  db.saveReaderSettings({ width: 720, fit: "original", quality: "data-saver" });
  db.acknowledgeRelease({ key: "ANIME:1", unit: 3 });
}
function files(backup: LocalBackup): BackupFiles {
  return {
    chooseExport: vi.fn(async () => "/chosen.json"),
    chooseImport: vi.fn(async () => "/chosen.json"),
    read: vi.fn(async () => backup),
    write: vi.fn(async () => undefined),
  };
}

it("round-trips local history and preferences without accounts, URLs, sync queues or catalog data", () => {
  const source = database();
  seed(source);
  source.acknowledgeActivity(42, 1, 0, "private sync error");
  source.saveCachedAniListDashboard({
    profile: { id: 42, name: "private-profile-sentinel" },
    animeLists: [],
    mangaLists: [],
  } as never);
  const backup = source.backup.snapshot();
  const exported = JSON.stringify(backup);
  for (const key of [
    "owner",
    "syncError",
    "synced",
    "coverUrl",
    "siteUrl",
    "private sync error",
    "secret-cover",
    "profile",
    "private-profile-sentinel",
    "genres",
  ])
    expect(exported).not.toContain(key);
  const target = database();
  expect(target.backup.preview(backup)).toEqual({
    titles: 2,
    mangaPreferences: 1,
    releaseAcknowledgements: 1,
    readerSettings: true,
    keptExisting: 0,
  });
  target.backup.restore(backup);
  expect(target.getPlaybackResume(1)).toEqual(source.getPlaybackResume(1));
  expect(target.getMangaReadingResume(2)).toEqual(source.getMangaReadingResume(2));
  expect(target.getReaderSettings()).toEqual(source.getReaderSettings());
  expect(target.getMangaReaderPreferences(2)).toEqual(source.getMangaReaderPreferences(2));
  expect(target.getReleaseAcknowledgements()).toEqual(source.getReleaseAcknowledgements());
  expect(target.listActivity(42)).toHaveLength(2);
  expect(target.listActivity(42).every((row) => row.syncStatus === "local")).toBe(true);
  expect(target.pendingActivity(42)).toEqual([]);
  expect(target.pendingActivity(99)).toEqual([]);
  const restoredMedia = target.listActivity().find((row) => row.media.id === 1)!.media;
  expect(restoredMedia.siteUrl).toBe("https://anilist.co/anime/1");
  expect(() =>
    target.recordActivity({ media: restoredMedia, unit: 3, state: "started" }),
  ).not.toThrow();
  expect(target.backup.restore(backup)).toEqual({
    titles: 0,
    mangaPreferences: 0,
    releaseAcknowledgements: 0,
    readerSettings: false,
    keptExisting: 5,
  });
});

it("keeps local completions and explicit preferences even when a backup has a newer checkpoint", () => {
  const source = database();
  seed(source);
  const target = database();
  target.recordActivity(
    {
      media: { id: 1, type: "ANIME", coverUrl: "", siteUrl: "", title: "Done" },
      unit: 12,
      state: "completed",
    },
    99,
  );
  target.saveReaderSettings({ width: 1400, fit: "width", quality: "data" });
  target.backup.restore(source.backup.snapshot());
  expect(target.getPlaybackResume(1)).toBeUndefined();
  expect(target.listActivity(99).find((row) => row.media.id === 1)?.unit).toBe(12);
  expect(target.getReaderSettings().width).toBe(1400);
  expect(target.getMangaReadingResume(2)?.progress).toBe(0.4);
});

it("retains legacy checkpoints with no journal and deduplicates a title across sign-ins", () => {
  const db = database();
  seed(db);
  db.recordActivity({
    media: { id: 1, type: "ANIME", coverUrl: "", siteUrl: "", title: "Local Sky" },
    unit: 3,
    state: "started",
  });
  db.saveMangaReadingResume({ aniListId: 3, chapterId: "unknown-number", progress: 0.6 });
  const backup = db.backup.snapshot();
  expect(backup.titles).toHaveLength(3);
  const target = database();
  target.backup.restore(backup);
  expect(target.getMangaReadingResume(3)).toEqual(db.getMangaReadingResume(3));
});

it("rejects malformed, duplicate, unsupported and excessive data before any writes", () => {
  const source = database();
  seed(source);
  const backup = source.backup.snapshot();
  const target = database();
  for (const malformed of [
    null,
    [],
    { ...backup, version: 2 },
    { ...backup, titles: [...backup.titles, backup.titles[0]] },
    { ...backup, titles: Array(10001).fill(backup.titles[0]) },
    { ...backup, exportedAt: "tomorrow" },
    { ...backup, readerSettings: { width: 800 } },
    { ...backup, titles: [{ ...backup.titles[0], aniListId: 1.5 }] },
    {
      ...backup,
      titles: [{ ...backup.titles[0], playback: { ...backup.titles[0].playback, aniListId: 2 } }],
    },
    {
      ...backup,
      titles: [
        {
          ...backup.titles[1],
          reading: { ...backup.titles[1].reading, chapterId: "../private", progress: 2 },
        },
      ],
    },
  ]) {
    expect(() => target.backup.restore(malformed as LocalBackup)).toThrow();
    expect(target.listActivity()).toEqual([]);
  }
  const sanitized = parseLocalBackup({
    ...backup,
    accessToken: "fake-secret",
    titles: backup.titles.map((row) => ({
      ...row,
      owner: 42,
      activity: { ...row.activity, synced: 0, password: "fake-password" },
    })),
  });
  expect(JSON.stringify(sanitized)).not.toContain("fake-");
  expect(JSON.stringify(sanitized)).not.toContain("owner");
});

it("rolls back every table after a late database failure and persists a successful restore", () => {
  const path = join(directory(), "restore.sqlite");
  const target = database(path);
  const source = database();
  seed(source);
  const raw = new Database(path);
  raw.exec(
    "CREATE TRIGGER reject_preference BEFORE INSERT ON manga_reader_preferences_v1 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  expect(() => target.backup.restore(source.backup.snapshot())).toThrow("fixture failure");
  expect(target.listActivity()).toEqual([]);
  expect(target.getPlaybackResume(1)).toBeUndefined();
  expect(target.getMangaReadingResume(2)).toBeUndefined();
  raw.exec("DROP TRIGGER reject_preference");
  raw.close();
  target.backup.restore(source.backup.snapshot());
  // A second connection observes committed data, independent of repository memory.
  const reopened = database(path);
  expect(reopened.getReaderSettings().width).toBe(720);
  expect(reopened.listActivity()).toHaveLength(2);
});

it("stages a validated immutable preview, rechecks conflicts, and consumes restore tokens once", async () => {
  const source = database();
  seed(source);
  const backup = source.backup.snapshot();
  const target = database();
  const changed = vi.fn();
  const service = createBackupService(target.backup, files(backup), changed);
  const preview = (await service.prepare())!;
  expect(target.listActivity()).toEqual([]);
  backup.titles[1].reading!.progress = 0.99;
  target.recordActivity(
    {
      media: { id: 1, type: "ANIME", coverUrl: "", siteUrl: "", title: "New local activity" },
      unit: 8,
      state: "completed",
    },
    42,
  );
  const result = await service.restore(preview.token);
  expect(result.titles).toBe(1);
  expect(result.keptExisting).toBe(1);
  expect(target.getMangaReadingResume(2)?.progress).toBe(0.4);
  expect(target.getPlaybackResume(1)).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(1);
  await expect(service.restore(preview.token)).rejects.toThrow("expired");
});

it("handles dialog cancellation, invalid files, expired previews and safe error messages", async () => {
  const target = database();
  const io = files(target.backup.snapshot());
  let now = 0;
  const service = createBackupService(target.backup, io, vi.fn(), () => now);
  vi.mocked(io.chooseExport).mockResolvedValueOnce(undefined);
  expect(await service.export()).toBe(false);
  expect(io.write).not.toHaveBeenCalled();
  vi.mocked(io.chooseImport).mockResolvedValueOnce(undefined);
  expect(await service.prepare()).toBeNull();
  vi.mocked(io.read).mockRejectedValueOnce(new Error("/private/file.json"));
  await expect(service.prepare()).rejects.toThrow("Could not read");
  const preview = (await service.prepare())!;
  now = 300001;
  await expect(service.restore(preview.token)).rejects.toThrow("expired");
  const another = (await service.prepare())!;
  service.cancel(another.token);
  await expect(service.restore(another.token)).rejects.toThrow("expired");
  vi.mocked(io.write).mockRejectedValueOnce(new Error("/private/location"));
  await expect(service.export()).rejects.toThrow("Could not save");
  expect(await service.export()).toBe(true);
});

it("rejects overlapping native dialog operations", async () => {
  const target = database();
  const io = files(target.backup.snapshot());
  let resolve!: (value: string | undefined) => void;
  io.chooseImport = () =>
    new Promise((done) => {
      resolve = done;
    });
  const service = createBackupService(target.backup, io, vi.fn());
  const pending = service.prepare();
  await expect(service.export()).rejects.toThrow("already in progress");
  resolve(undefined);
  await expect(pending).resolves.toBeNull();
});

it("writes a complete selected file atomically and bounds import reads", async () => {
  const dir = directory();
  const path = join(dir, "backup.json");
  writeFileSync(path, "old backup");
  const backup = database().backup.snapshot();
  await writeBackupFile(path, JSON.stringify(backup));
  expect(await readBackupFile(path)).toEqual(backup);
  expect(readdirSync(dir)).toEqual(["backup.json"]);
  await expect(writeBackupFile(path, "x".repeat(BACKUP_MAX_BYTES + 1))).rejects.toThrow("limit");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(backup);
  writeFileSync(path, Buffer.alloc(BACKUP_MAX_BYTES + 1));
  await expect(readBackupFile(path)).rejects.toThrow("limit");
  writeFileSync(path, "not JSON");
  await expect(readBackupFile(path)).rejects.toThrow();
});

it("exposes no path or payload IPC and validates preview tokens", () => {
  for (const channel of ["backup:export", "backup:prepare"] as const) {
    expect(ipcArgValidators[channel]([])).toEqual([]);
    expect(() => ipcArgValidators[channel](["/private/file"])).toThrow();
  }
  for (const channel of ["backup:restore", "backup:cancel"] as const) {
    for (const invalid of ["/private/file", "", {}, 1])
      expect(() => ipcArgValidators[channel]([invalid])).toThrow();
    expect(ipcArgValidators[channel](["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])).toHaveLength(1);
    expect(() => ipcArgValidators[channel](["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {}])).toThrow();
  }
});
