import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { FieldSnapshots, createSnapshotStore } from "../../src/main/field-snapshots";
import {
  isTrendingRequest,
  isUsableAniListPage,
  isUsableDiscoveryFeed,
  withoutDiscoveryTitle,
} from "../../src/main/home-fields";

const page = (ids: number[]) => ({
  pageInfo: { currentPage: 1, hasNextPage: true },
  items: ids.map((id) => ({ id, title: `Title ${id}` })),
});

function setup(now = 1_000_000) {
  const store = createSnapshotStore(new Database(":memory:"));
  const timers: Array<() => void> = [];
  const snapshots = new FieldSnapshots({
    store: () => store,
    now: () => now,
    setTimer: (run) => void timers.push(run),
  });
  const runTimers = async () => {
    while (timers.length) {
      timers.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { store, snapshots, runTimers };
}

const field = (load: () => Promise<unknown>) => ({
  key: "anilist-trending:ANIME:20",
  load,
  usable: isUsableAniListPage,
});

describe("field snapshots", () => {
  it("loads live without a saved copy, saves it, and keeps it for the session", async () => {
    const { store, snapshots } = setup();
    const load = vi.fn(async () => page([1, 2]));
    expect(await snapshots.get(field(load))).toEqual(page([1, 2]));
    expect(await snapshots.get(field(load))).toEqual(page([1, 2]));
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.read("anilist-trending:ANIME:20")?.value).toEqual(page([1, 2]));
  });

  it("shows the saved copy at once and refreshes it in the background for next launch", async () => {
    const { store, snapshots, runTimers } = setup();
    store.write("anilist-trending:ANIME:20", page([1]), 999_000);
    const load = vi.fn(async () => page([9]));

    expect(await snapshots.get(field(load))).toEqual(page([1]));
    expect(load).not.toHaveBeenCalled();
    await runTimers();
    expect(load).toHaveBeenCalledTimes(1);
    // The session keeps showing what it showed; the refreshed copy waits for the next launch.
    expect(await snapshots.get(field(load))).toEqual(page([1]));
    expect(store.read("anilist-trending:ANIME:20")?.value).toEqual(page([9]));
  });

  it("rebuilds on a fresh request and never pins or saves an empty answer", async () => {
    const { store, snapshots } = setup();
    store.write("anilist-trending:ANIME:20", page([1]), 999_000);
    expect(
      await snapshots.get(
        field(async () => page([5])),
        true,
      ),
    ).toEqual(page([5]));

    const empty = vi.fn(async () => page([]));
    const other = { ...field(empty), key: "anilist-trending:MANGA:20" };
    await snapshots.get(other);
    await snapshots.get(other);
    expect(empty).toHaveBeenCalledTimes(2);
    expect(store.read("anilist-trending:MANGA:20")).toBeUndefined();
  });

  it("ignores a saved copy older than a week and survives a failing store", async () => {
    const week = 7 * 86_400_000;
    const { store, snapshots } = setup(week + 10);
    store.write("anilist-trending:ANIME:20", page([1]), 0);
    expect(await snapshots.get(field(async () => page([2])))).toEqual(page([2]));

    const broken = new FieldSnapshots({
      store: () => ({
        read: () => {
          throw new Error("disk");
        },
        write: () => {
          throw new Error("disk");
        },
      }),
    });
    expect(await broken.get(field(async () => page([3])))).toEqual(page([3]));
  });

  it("drops a dismissed title from the session answer and the saved feed", async () => {
    const { store, snapshots } = setup();
    const feed = {
      status: "ready",
      requestId: "r1",
      items: [{ anilistId: 1 }, { anilistId: 2 }],
      rows: [{ seedId: 5, seedTitle: "S", items: [{ anilistId: 2 }, { anilistId: 3 }] }],
    };
    store.write("for-you:7:ANIME", feed, 999_000);
    const forYou = {
      key: "for-you:7:ANIME",
      load: async () => feed,
      usable: isUsableDiscoveryFeed,
    };
    await snapshots.get(forYou);
    snapshots.update("for-you:7:ANIME", (value) => withoutDiscoveryTitle(value, 2));
    const expected = {
      ...feed,
      items: [{ anilistId: 1 }],
      rows: [{ seedId: 5, seedTitle: "S", items: [{ anilistId: 3 }] }],
    };
    expect(await snapshots.get(forYou)).toEqual(expected);
    expect(store.read("for-you:7:ANIME")?.value).toEqual(expected);
  });

  it("retries an empty answer once in the background and saves the recovered copy", async () => {
    const { store, snapshots, runTimers } = setup();
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([4]));
    const manga = { ...field(load), key: "anilist-trending:MANGA:20" };
    expect(await snapshots.get(manga)).toEqual(page([]));
    await runTimers();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.read("anilist-trending:MANGA:20")?.value).toEqual(page([4]));
  });

  it("treats only plain page-1 Trending as a saved field", () => {
    expect(isTrendingRequest({ type: "ANIME", page: 1, perPage: 20, sort: "TRENDING_DESC" })).toBe(
      true,
    );
    expect(isTrendingRequest({ type: "ANIME", page: 2, sort: "TRENDING_DESC" })).toBe(false);
    expect(
      isTrendingRequest({ type: "ANIME", page: 1, sort: "TRENDING_DESC", genre: "Action" }),
    ).toBe(false);
    expect(isTrendingRequest({ type: "ANIME", page: 1, sort: "SCORE_DESC" })).toBe(false);
  });
});
