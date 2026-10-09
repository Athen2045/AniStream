import { describe, expect, it, vi } from "vitest";
import type { BingeState } from "../../src/shared/binge";
import {
  animeBingeItem,
  bingeAnimeMedia,
  bingeMoreItem,
  createBingeSession,
  moreBingeItem,
} from "../../src/renderer/src/binge-session";

const item = animeBingeItem({
  id: 7,
  type: "ANIME",
  title: "Show",
  coverUrl: "https://s4.anilist.co/file/anilistcdn/7.jpg",
  totalProgress: 12,
  genres: ["Drama"],
  siteUrl: "https://anilist.co/anime/7",
});

describe("Up Next session", () => {
  it("loads, applies, and takes the next entry off the queue", async () => {
    let state: BingeState = {
      queue: [{ key: "anime:7", item, addedAt: "2026-10-06T00:00:00.000Z" }],
      playlists: [],
    };
    const bridge = {
      getBingeState: vi.fn(async () => state),
      applyBingeChange: vi.fn(async () => {
        state = { ...state, queue: [] };
        return state;
      }),
    };
    const session = createBingeSession(bridge);
    await session.load();
    expect(session.getSnapshot()).toMatchObject({ loaded: true, queue: [{ key: "anime:7" }] });
    expect(session.isQueued(item)).toBe(true);
    const next = await session.takeNext();
    expect(next?.key).toBe("anime:7");
    expect(bridge.applyBingeChange).toHaveBeenCalledWith({
      op: "remove",
      target: { list: "queue" },
      key: "anime:7",
    });
    expect(session.getSnapshot().queue).toEqual([]);
    expect(await session.takeNext()).toBeUndefined();
  });

  it("shows limit messages as written and hides other failures", async () => {
    const bridge = {
      getBingeState: vi.fn(async () => ({ queue: [], playlists: [] })),
      applyBingeChange: vi
        .fn()
        .mockRejectedValueOnce(new Error("A list holds up to 200 titles."))
        .mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked")),
    };
    const session = createBingeSession(bridge);
    expect(await session.apply({ op: "clear", target: { list: "queue" } })).toBe(false);
    expect(session.getSnapshot().error).toBe("A list holds up to 200 titles.");
    await session.apply({ op: "clear", target: { list: "queue" } });
    expect(session.getSnapshot().error).toBe("That change could not be saved. Try again.");
    session.dismissError();
    expect(session.getSnapshot().error).toBeUndefined();
  });

  it("round-trips items to the shapes the title pages open with", () => {
    expect(bingeAnimeMedia(item as Extract<typeof item, { kind: "anime" }>)).toMatchObject({
      id: 7,
      type: "ANIME",
      totalProgress: 12,
      siteUrl: "https://anilist.co/anime/7",
    });
    const more = moreBingeItem(
      { id: 3, type: "TV", title: "Series", genres: [], siteUrl: "x" },
      2,
      5,
    );
    expect(more).toMatchObject({ kind: "more", season: 2, episode: 5 });
    expect(bingeMoreItem(more as Extract<typeof more, { kind: "more" }>)).toMatchObject({
      id: 3,
      type: "TV",
      siteUrl: "https://www.themoviedb.org/tv/3",
    });
    // Movies never carry an episode target.
    expect(
      moreBingeItem({ id: 4, type: "MOVIE", title: "Film", genres: [], siteUrl: "x" }, 1, 1),
    ).not.toHaveProperty("season");
  });
});
