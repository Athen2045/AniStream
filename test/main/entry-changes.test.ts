import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AniListDashboard, AniListEntry } from "../../src/shared/contracts";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("../../src/main/ipc", () => ({
  registerTrustedIpcHandler: (_origin: string, channel: string, handler: never) =>
    handlers.set(channel, handler),
}));

const { openAppDatabase } = await import("../../src/main/database");
const { applyEntryChanges } = await import("../../src/main/entry-changes");
const { registerTrackerDomain } = await import("../../src/main/domains/tracker");
const { AniListUnavailableError } = await import("../../src/main/anilist/errors");

function entry(id: number, status: AniListEntry["status"], progress = 1): AniListEntry {
  return {
    id,
    status,
    score: 0,
    progress,
    repeat: 0,
    updatedAt: 1,
    media: {
      id: 100 + id,
      type: "ANIME",
      title: `Title ${id}`,
      coverUrl: "",
      siteUrl: `https://anilist.co/anime/${100 + id}`,
    },
  };
}
const library = (): AniListDashboard => ({
  profile: {
    id: 7,
    name: "viewer",
    avatarUrl: "",
    siteUrl: "https://anilist.co/user/viewer",
    animeCount: 3,
    episodesWatched: 14,
    minutesWatched: 336,
    mangaCount: 0,
    chaptersRead: 0,
    volumesRead: 0,
  },
  animeLists: [
    { name: "Watching", isCustomList: false, entries: [entry(1, "CURRENT"), entry(2, "CURRENT")] },
    { name: "Completed", isCustomList: false, entries: [entry(3, "COMPLETED", 12)] },
  ],
  mangaLists: [],
  fetchedAt: new Date(0).toISOString(),
});

const directories: string[] = [];
const open: Array<{ close(): void }> = [];
async function database() {
  const directory = await mkdtemp(join(tmpdir(), "anistream-queue-"));
  directories.push(directory);
  const db = openAppDatabase(join(directory, "anistream.sqlite"));
  open.push(db);
  return db;
}
afterEach(async () => {
  handlers.clear();
  for (const db of open.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("offline library edit queue", () => {
  it("merges repeated edits per entry and lets a delete replace them", async () => {
    const db = await database();
    db.queueEntryChange(7, {
      kind: "update",
      entryId: 1,
      input: { id: 1, score: 8 },
      queuedAt: "a",
    });
    db.queueEntryChange(7, {
      kind: "update",
      entryId: 1,
      input: { id: 1, progress: 5 },
      queuedAt: "b",
    });
    db.queueEntryChange(7, {
      kind: "update",
      entryId: 2,
      input: { id: 2, score: 5 },
      queuedAt: "c",
    });
    db.queueEntryChange(7, { kind: "delete", entryId: 2, queuedAt: "d" });

    expect(db.pendingEntryChanges(7)).toEqual([
      { kind: "update", entryId: 1, input: { id: 1, score: 8, progress: 5 }, queuedAt: "b" },
      { kind: "delete", entryId: 2, queuedAt: "d" },
    ]);
    expect(db.pendingEntryChanges(8)).toEqual([]);
  });

  it("shows queued edits on the library copy, moving status changes between lists", () => {
    const next = applyEntryChanges(library(), [
      {
        kind: "update",
        entryId: 1,
        input: { id: 1, status: "COMPLETED", progress: 12 },
        queuedAt: "a",
      },
      { kind: "delete", entryId: 2, queuedAt: "b" },
    ]);
    expect(next.animeLists.map((group) => [group.name, group.entries.map((e) => e.id)])).toEqual([
      ["Completed", [1, 3]],
    ]);
    expect(next.animeLists[0].entries[0]).toMatchObject({ status: "COMPLETED", progress: 12 });
  });

  it("queues edits while AniList is down and sends them before the next refresh", async () => {
    const db = await database();
    db.saveCachedAniListDashboard(library());
    let online = false;
    const aniList = {
      getState: () => ({ status: "signed-in", profile: { id: 7 } }),
      updateEntry: vi.fn(async (input: { id: number }) => {
        if (!online) throw new AniListUnavailableError();
        return { id: input.id, status: "CURRENT", score: 9, progress: 1 };
      }),
      deleteEntry: vi.fn(async () => {
        if (!online) throw new TypeError("fetch failed");
      }),
      getDashboard: vi.fn(async () => library()),
    };
    const onChanged = vi.fn();
    registerTrackerDomain("app://x", { aniList: aniList as never, database: db, onChanged });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

    await expect(call("anilist:update-entry", { id: 1, score: 9 })).resolves.toMatchObject({
      id: 1,
      score: 9,
      queued: true,
    });
    await expect(call("anilist:delete-entry", 2)).resolves.toEqual({ queued: true });
    expect(await call("anilist:pending-changes")).toBe(2);
    const offline = db.getCachedAniListDashboard()!;
    expect(offline.animeLists[0].entries.map((e) => [e.id, e.score])).toEqual([[1, 9]]);
    expect(onChanged).toHaveBeenCalled();

    online = true;
    const refreshed = (await call("anilist:dashboard")) as AniListDashboard;
    expect(aniList.updateEntry).toHaveBeenLastCalledWith({ id: 1, score: 9 });
    expect(aniList.deleteEntry).toHaveBeenLastCalledWith(2);
    expect(await call("anilist:pending-changes")).toBe(0);
    expect(refreshed.animeLists[0].entries.map((e) => e.id)).toEqual([1, 2]);
  });

  it("surfaces edits AniList rejects instead of queueing them", async () => {
    const db = await database();
    const aniList = {
      getState: () => ({ status: "signed-in", profile: { id: 7 } }),
      updateEntry: vi.fn(async () => {
        throw new Error("Invalid score.");
      }),
    };
    registerTrackerDomain("app://x", { aniList: aniList as never, database: db });
    await expect(handlers.get("anilist:update-entry")!({}, { id: 1, score: 99 })).rejects.toThrow(
      "Invalid score.",
    );
    expect(db.pendingEntryChanges(7)).toEqual([]);
  });
});
