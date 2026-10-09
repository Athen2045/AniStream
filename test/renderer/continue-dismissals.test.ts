import { describe, expect, it, vi } from "vitest";
import {
  continueKey,
  isRemovedFromContinue,
  parseRemoved,
} from "../../src/renderer/src/continue-dismissals";
import { createPersonalLibrarySession } from "../../src/renderer/src/personal-library-session";
import type { LocalActivity } from "../../src/shared/activity";

describe("continue removals", () => {
  it("hides a title only until it has newer activity", () => {
    const removed = { [continueKey("ANIME", 5)]: 2_000 };
    expect(isRemovedFromContinue(removed, "ANIME:5", 1_500)).toBe(true);
    expect(isRemovedFromContinue(removed, "ANIME:5", 2_000)).toBe(true);
    expect(isRemovedFromContinue(removed, "ANIME:5", 2_500)).toBe(false);
    expect(isRemovedFromContinue(removed, "MANGA:5", 1_000)).toBe(false);
  });

  it("keeps only well-formed entries, More keys included, newest first and bounded", () => {
    expect(
      parseRemoved({
        "ANIME:1": 10,
        "MORE:MOVIE:603": 20,
        "BOGUS:1": 30,
        "MANGA:2": "soon",
        "MANGA:3": Number.NaN,
      }),
    ).toEqual({ "MORE:MOVIE:603": 20, "ANIME:1": 10 });
    expect(parseRemoved(["ANIME:1"])).toEqual({});
    const many = Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [`ANIME:${index}`, index]),
    );
    const kept = parseRemoved(many);
    expect(Object.keys(kept)).toHaveLength(500);
    expect(kept["ANIME:599"]).toBe(599);
    expect(kept["ANIME:0"]).toBeUndefined();
  });

  it("filters removed titles out of the session's Continue rows", async () => {
    const activity: LocalActivity[] = [1, 2].map((id) => ({
      media: { id, type: "ANIME", title: `T${id}`, coverUrl: "", siteUrl: "", totalProgress: 12 },
      unit: 3,
      completedProgress: 2,
      state: "started",
      updatedAt: new Date(1_000).toISOString(),
      syncStatus: "local",
    }));
    let hidden = new Set<number>();
    const session = createPersonalLibrarySession(
      { kind: "guest" },
      {
        getLocalActivity: vi.fn(async () => activity),
        getPersonalAnimeUpdates: vi.fn(async () => []),
        getMangaDexAvailability: vi.fn(async () => []),
        retryActivitySync: vi.fn(async () => activity),
        getPendingAniListChanges: vi.fn(async () => 0),
      },
      { now: () => 5_000, visible: () => true, hidden: ({ media }) => hidden.has(media.id) },
    );
    session.activate();
    await vi.waitFor(() => expect(session.getSnapshot().continuing.ANIME).toHaveLength(2));
    hidden = new Set([1]);
    session.invalidateHidden();
    expect(session.getSnapshot().continuing.ANIME.map((title) => title.media.id)).toEqual([2]);
    expect(session.getSnapshot().continueAnime.map((title) => title.id)).toEqual([2]);
    hidden = new Set();
    session.invalidateHidden();
    expect(session.getSnapshot().continuing.ANIME).toHaveLength(2);
    session.dispose();
  });
});
