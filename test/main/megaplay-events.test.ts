import { describe, expect, it } from "vitest";
import { parseMegaPlayEvent } from "../../src/shared/megaplay-events";

describe("MegaPlay event validation", () => {
  it("accepts documented progress and completion events", () => {
    expect(parseMegaPlayEvent({ event: "time", time: 90, duration: 100, percent: 90 })).toEqual({
      kind: "progress",
      currentTime: 90,
      duration: 100,
      percent: 90,
    });
    expect(
      parseMegaPlayEvent(JSON.stringify({ type: "watching-log", currentTime: 15, duration: 24 })),
    ).toEqual({
      kind: "progress",
      currentTime: 15,
      duration: 24,
    });
    expect(parseMegaPlayEvent({ event: "complete" })).toEqual({ kind: "complete" });
  });

  it("rejects malformed, oversized, or out-of-range messages", () => {
    expect(parseMegaPlayEvent({ event: "time", time: -1, duration: 100 })).toBeUndefined();
    expect(parseMegaPlayEvent({ event: "time", time: 1, duration: 0 })).toBeUndefined();
    expect(parseMegaPlayEvent({ event: "time", time: 1, duration: 2, percent: 101 })).toEqual({
      kind: "progress",
      currentTime: 1,
      duration: 2,
      percent: undefined,
    });
    expect(parseMegaPlayEvent("x".repeat(4_097))).toBeUndefined();
  });
});
