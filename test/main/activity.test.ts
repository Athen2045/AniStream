import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import { createActivityService } from "../../src/main/activity/service";
import { reconcileActivity } from "../../src/main/activity/reconcile";

const media = {
  id: 42,
  type: "ANIME" as const,
  title: "Saved story",
  coverUrl: "https://example.test/cover",
  siteUrl: "https://anilist.co/anime/42",
};
describe("durable local activity", () => {
  it("returns durable completion while remote sync is still pending and tolerates shutdown", async () => {
    const db = openAppDatabase(":memory:");
    let finish: () => void = () => undefined;
    const remote = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = createActivityService(db, { owner: () => 7, reconcile: () => remote });
    const result = await Promise.race([
      service.record({ media, unit: 3, state: "completed" }),
      Promise.resolve("blocked"),
    ]);
    expect(result).toMatchObject({ state: "completed", syncStatus: "pending" });
    service.dispose();
    db.close();
    finish();
    await service.retry();
  });
  it("stores checkpoint and activity together and clears only the completed anime episode", () => {
    const db = openAppDatabase(":memory:");
    try {
      db.recordActivity({
        media,
        unit: 3,
        state: "started",
        checkpoint: { aniListId: 42, episode: 3, positionSeconds: 20, durationSeconds: 100 },
      });
      expect(db.getPlaybackResume(42)?.positionSeconds).toBe(20);
      expect(db.listActivity()[0].unit).toBe(3);
      expect(() =>
        db.recordActivity({
          media,
          unit: 3,
          state: "started",
          checkpoint: { aniListId: 99, episode: 3, positionSeconds: 25, durationSeconds: 100 },
        }),
      ).toThrow();
      expect(db.getPlaybackResume(42)?.positionSeconds).toBe(20);
      db.recordActivity({
        media,
        unit: 4,
        state: "started",
        checkpoint: { aniListId: 42, episode: 4, positionSeconds: 30, durationSeconds: 100 },
      });
      db.recordActivity({ media, unit: 3, state: "completed" });
      expect(db.getPlaybackResume(42)?.episode).toBe(4);
    } finally {
      db.close();
    }
  });
  it("never lowers newer remote progress or writes after the account changes during lookup", async () => {
    let owner = 7;
    let writes = 0;
    const activity = {
      media,
      unit: 3,
      state: "completed" as const,
      completedProgress: 3,
      updatedAt: "today",
      syncStatus: "pending" as const,
    };
    const tracker = {
      owner: () => owner,
      read: async () => ({ id: 8, progress: 9, status: "COMPLETED" as const, score: 8 }),
      add: async () => {
        writes++;
        return { id: 8, progress: 0, status: "PLANNING" as const, score: 0 };
      },
      update: async () => {
        writes++;
      },
    };
    await reconcileActivity(7, activity, tracker);
    expect(writes).toBe(0);
    tracker.read = async () => {
      owner = 8;
      return { id: 8, progress: 1, status: "COMPLETED", score: 8 };
    };
    await expect(reconcileActivity(7, activity, tracker)).rejects.toThrow("account changed");
    expect(writes).toBe(0);
  });
  it("keeps guest completion across restart without importing it into a later account", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anistream-activity-"));
    const path = join(directory, "test.sqlite");
    let db = openAppDatabase(path);
    let owner: number | undefined;
    let writes = 0;
    const tracker = {
      owner: () => owner,
      reconcile: async () => {
        writes += 1;
      },
    };
    await createActivityService(db, tracker).record({ media, unit: 3, state: "completed" });
    db.close();
    db = openAppDatabase(path);
    owner = 7;
    const service = createActivityService(db, tracker);
    await service.retry();
    expect(service.list()[0]).toMatchObject({
      media,
      completedProgress: 3,
      state: "completed",
      syncStatus: "local",
    });
    expect(writes).toBe(0);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("journals before failure, isolates accounts, coalesces duplicates, and retries once", async () => {
    const db = openAppDatabase(":memory:");
    let owner = 7;
    let fail = true;
    let writes = 0;
    const service = createActivityService(db, {
      owner: () => owner,
      reconcile: async (_owner, activity) => {
        expect(db.listActivity(7)[0].completedProgress).toBe(3);
        if (fail) throw new Error("offline");
        writes += 1;
        expect(activity.completedProgress).toBe(3);
      },
    });
    await service.record({ media, unit: 3, state: "completed" });
    await service.retry();
    expect(service.list()[0]).toMatchObject({ syncStatus: "pending", syncError: "offline" });
    owner = 8;
    await service.retry();
    expect(writes).toBe(0);
    owner = 7;
    fail = false;
    await Promise.all([service.retry(), service.retry()]);
    await service.record({ media, unit: 3, state: "completed" });
    expect(writes).toBe(1);
    expect(service.list()[0].syncStatus).toBe("synced");
    db.close();
  });
});
