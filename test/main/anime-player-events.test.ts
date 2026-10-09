import { describe, expect, it } from "vitest";
import { parseAnimePlayerMessage } from "../../src/shared/anime-player-events";

describe("Anime player message validation", () => {
  it("accepts documented progress and completion events", () => {
    expect(
      parseAnimePlayerMessage({ event: "time", time: 90, duration: 100, percent: 90 }),
    ).toEqual({
      kind: "progress",
      currentTime: 90,
      duration: 100,
      percent: 90,
    });
    expect(
      parseAnimePlayerMessage(
        JSON.stringify({ type: "watching-log", currentTime: 15, duration: 24 }),
      ),
    ).toEqual({
      kind: "progress",
      currentTime: 15,
      duration: 24,
    });
    expect(parseAnimePlayerMessage({ event: "complete" })).toEqual({ kind: "complete" });
  });

  it("rejects malformed, oversized, or out-of-range messages", () => {
    expect(parseAnimePlayerMessage({ event: "time", time: -1, duration: 100 })).toBeUndefined();
    expect(parseAnimePlayerMessage({ event: "time", time: 1, duration: 0 })).toBeUndefined();
    expect(parseAnimePlayerMessage({ event: "time", time: 1, duration: 2, percent: 101 })).toEqual({
      kind: "progress",
      currentTime: 1,
      duration: 2,
      percent: undefined,
    });
    expect(parseAnimePlayerMessage("x".repeat(4_097))).toBeUndefined();
  });
});
