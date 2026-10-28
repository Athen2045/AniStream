import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createTitleCopies, withTitleCopy } from "../../src/main/title-copies";

describe("title copies (offline title pages)", () => {
  it("saves live answers and serves the copy only when the live load fails", async () => {
    const copies = createTitleCopies(new Database(":memory:"), () => []);
    const live = await withTitleCopy(copies, "detail:ANIME:1", 1, async () => ({ title: "Live" }));
    expect(live).toEqual({ title: "Live" });
    // Online again: the newer live answer replaces the copy.
    await withTitleCopy(copies, "detail:ANIME:1", 1, async () => ({ title: "Newer" }));
    const offline = await withTitleCopy(copies, "detail:ANIME:1", 1, async () => {
      throw new TypeError("fetch failed");
    });
    expect(offline).toEqual({ title: "Newer" });
  });

  it("treats an empty answer as a failure when a copy exists", async () => {
    const copies = createTitleCopies(new Database(":memory:"), () => []);
    await withTitleCopy(
      copies,
      "episodes:2",
      2,
      async () => ({ seasons: [{ number: 1 }] }),
      (catalog) => catalog.seasons.length > 0,
    );
    const offline = await withTitleCopy(
      copies,
      "episodes:2",
      2,
      async () => ({ seasons: [] as { number: number }[] }),
      (catalog) => catalog.seasons.length > 0,
    );
    expect(offline).toEqual({ seasons: [{ number: 1 }] });
    // Without a copy the empty answer stands, and the failure stands for throwing loads.
    expect(
      await withTitleCopy(
        copies,
        "episodes:3",
        3,
        async () => ({ seasons: [] }),
        () => false,
      ),
    ).toEqual({ seasons: [] });
    await expect(
      withTitleCopy(copies, "detail:ANIME:9", 9, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
  });

  it("never fails a page because saving the copy failed", async () => {
    const copies = {
      read: vi.fn(() => undefined),
      write: vi.fn(() => {
        throw new Error("disk full");
      }),
    };
    expect(await withTitleCopy(copies, "series:1", 1, async () => 42)).toBe(42);
  });

  it("keeps copies of titles with downloads when trimming old ones", async () => {
    const database = new Database(":memory:");
    const copies = createTitleCopies(database, () => [7]);
    copies.write("detail:ANIME:7", 7, { pinned: true });
    // Enough newer titles to push title 7 out of the recent window.
    for (let id = 1_000; id < 3_600; id += 1) copies.write(`detail:ANIME:${id}`, id, { id });
    expect(copies.read("detail:ANIME:7")).toEqual({ pinned: true });
    const count = database.prepare("SELECT COUNT(*) AS n FROM title_copy_v1").get() as {
      n: number;
    };
    expect(count.n).toBeLessThanOrEqual(2_500 + 50 + 1);
    expect(copies.read("detail:ANIME:1000")).toBeUndefined();
  });

  it("lists the saved episode art of titles with downloads only", () => {
    const copies = createTitleCopies(new Database(":memory:"), () => [7]);
    copies.write("art:7:28:0", 7, [{ episode: 1, stillUrl: "kept" }]);
    copies.write("episodes:7", 7, { seasons: [] });
    copies.write("art:8:12:0", 8, [{ episode: 1, stillUrl: "not kept" }]);
    expect(copies.pinned("art:")).toEqual([
      { key: "art:7:28:0", value: [{ episode: 1, stillUrl: "kept" }] },
    ]);
  });
});
