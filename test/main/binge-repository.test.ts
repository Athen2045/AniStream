import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createBingeRepository } from "../../src/main/binge-repository";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import {
  BINGE_LIST_LIMIT,
  bingeItemKey,
  bingeItemTarget,
  parseBingeItem,
  type BingeItem,
} from "../../src/shared/binge";

const anime = (id: number, episode?: number): BingeItem => ({
  kind: "anime",
  media: { id, title: `Anime ${id}`, coverUrl: `https://s4.anilist.co/file/anilistcdn/${id}.jpg` },
  ...(episode ? { episode } : {}),
});
const show = (id: number, season?: number, episode?: number): BingeItem => ({
  kind: "more",
  title: {
    id,
    type: "TV",
    title: `Show ${id}`,
    posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg",
  },
  ...(season && episode ? { season, episode } : {}),
});
const queue = { list: "queue" } as const;

function repository() {
  return createBingeRepository(new Database(":memory:"));
}

describe("Up Next and playlists store", () => {
  it("adds next or last, never twice, and keeps order through moves and removals", () => {
    const store = repository();
    store.applyBingeChange({ op: "add", target: queue, item: anime(1), position: "end" });
    store.applyBingeChange({ op: "add", target: queue, item: show(2), position: "end" });
    let state = store.applyBingeChange({
      op: "add",
      target: queue,
      item: anime(3),
      position: "next",
    });
    expect(state.queue.map((entry) => entry.key)).toEqual(["anime:3", "anime:1", "more:TV:2"]);
    // Re-adding moves the existing entry instead of duplicating it.
    state = store.applyBingeChange({ op: "add", target: queue, item: anime(3), position: "end" });
    expect(state.queue.map((entry) => entry.key)).toEqual(["anime:1", "more:TV:2", "anime:3"]);
    state = store.applyBingeChange({ op: "move", target: queue, key: "anime:3", index: 0 });
    expect(state.queue.map((entry) => entry.key)).toEqual(["anime:3", "anime:1", "more:TV:2"]);
    state = store.applyBingeChange({ op: "remove", target: queue, key: "anime:1" });
    expect(state.queue.map((entry) => entry.key)).toEqual(["anime:3", "more:TV:2"]);
    expect(store.getBingeState().queue).toEqual(state.queue);
  });

  it("treats a specific episode as its own entry", () => {
    const store = repository();
    store.applyBingeChange({ op: "add", target: queue, item: show(2), position: "end" });
    const state = store.applyBingeChange({
      op: "add",
      target: queue,
      item: show(2, 1, 3),
      position: "end",
    });
    expect(state.queue.map((entry) => entry.key)).toEqual(["more:TV:2", "more:TV:2:s1e3"]);
    expect(bingeItemTarget(show(2, 1, 3))).toBe("S1 · E3");
    expect(bingeItemTarget(anime(9))).toBe("Continue watching");
  });

  it("saves the queue as a playlist and plays a playlist as a copy", () => {
    const store = repository();
    store.applyBingeChange({ op: "add", target: queue, item: anime(1), position: "end" });
    store.applyBingeChange({ op: "add", target: queue, item: anime(2), position: "end" });
    let state = store.applyBingeChange({ op: "create-playlist", name: "Weekend", fromQueue: true });
    const playlist = state.playlists[0]!;
    expect(playlist.name).toBe("Weekend");
    expect(playlist.entries.map((entry) => entry.key)).toEqual(["anime:1", "anime:2"]);

    store.applyBingeChange({ op: "clear", target: queue });
    store.applyBingeChange({ op: "queue-playlist", id: playlist.id });
    state = store.applyBingeChange({ op: "remove", target: queue, key: "anime:1" });
    // Consuming Up Next never changes the saved playlist.
    expect(state.queue.map((entry) => entry.key)).toEqual(["anime:2"]);
    expect(state.playlists[0]!.entries).toHaveLength(2);

    state = store.applyBingeChange({ op: "rename-playlist", id: playlist.id, name: "Sunday" });
    expect(state.playlists[0]!.name).toBe("Sunday");
    state = store.applyBingeChange({ op: "delete-playlist", id: playlist.id });
    expect(state.playlists).toEqual([]);
    expect(() =>
      store.applyBingeChange({
        op: "add",
        target: { list: "playlist", id: playlist.id },
        item: anime(5),
        position: "end",
      }),
    ).toThrow(/no longer exists/);
  });

  it("enforces the list limit without losing what is there", () => {
    const store = repository();
    for (let id = 1; id <= BINGE_LIST_LIMIT; id += 1)
      store.applyBingeChange({ op: "add", target: queue, item: anime(id), position: "end" });
    expect(() =>
      store.applyBingeChange({ op: "add", target: queue, item: anime(9999), position: "end" }),
    ).toThrow(/holds up to/);
    expect(store.getBingeState().queue).toHaveLength(BINGE_LIST_LIMIT);
    // Moving an existing title within a full list still works.
    expect(
      store
        .applyBingeChange({ op: "add", target: queue, item: anime(1), position: "end" })
        .queue.at(-1)?.key,
    ).toBe("anime:1");
  });
});

describe("Up Next input validation", () => {
  it("accepts only allowlisted artwork and complete episode targets", () => {
    expect(parseBingeItem(anime(1))).toEqual(anime(1));
    expect(
      parseBingeItem({
        ...anime(1),
        media: { ...anime(1).media, coverUrl: "https://evil.example/a.jpg" },
      } as never),
    ).toBeUndefined();
    expect(parseBingeItem({ ...show(2), season: 1 })).toBeUndefined();
    expect(
      parseBingeItem({
        kind: "more",
        title: { id: 3, type: "MOVIE", title: "Film" },
        season: 1,
        episode: 1,
      }),
    ).toBeUndefined();
    expect(parseBingeItem({ kind: "manga", media: {} })).toBeUndefined();
    expect(bingeItemKey(show(2, 1, 3))).toBe("more:TV:2:s1e3");
  });

  it("validates IPC changes", () => {
    const validate = ipcArgValidators["binge:apply"];
    expect(validate([{ op: "clear", target: queue }])).toEqual([{ op: "clear", target: queue }]);
    expect(() => validate([{ op: "clear", target: { list: "playlist", id: 0 } }])).toThrow(
      /malformed/,
    );
    expect(() => validate([{ op: "create-playlist", name: "  ", fromQueue: false }])).toThrow(
      /malformed/,
    );
    expect(() =>
      validate([{ op: "create-playlist", name: "x".repeat(61), fromQueue: false }]),
    ).toThrow(/malformed/);
    expect(() => validate([{ op: "move", target: queue, key: "anime:1", index: -1 }])).toThrow(
      /malformed/,
    );
    expect(() => validate([{ op: "drop-table" }])).toThrow(/malformed/);
    expect(ipcArgValidators["binge:state"]([])).toEqual([]);
  });
});
