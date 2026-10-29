import { describe, expect, it } from "vitest";
import { isWrongMoreVideo } from "../../src/shared/more-player-runtime";

describe("More player wrong-video check", () => {
  it("flags a player serving another show of a very different length", () => {
    // Live-action episode (64 min on TMDB) served as the 25-minute anime episode, and back.
    expect(isWrongMoreVideo(1500, 64)).toBe(true);
    expect(isWrongMoreVideo(64 * 60, 25)).toBe(true);
    // A film instead of an episode.
    expect(isWrongMoreVideo(2 * 3600, 45)).toBe(true);
  });

  it("accepts normal differences from TMDB's whole-minute runtime", () => {
    expect(isWrongMoreVideo(23 * 60 + 40, 24)).toBe(false);
    expect(isWrongMoreVideo(58 * 60, 64)).toBe(false);
    // Recaps and credits trimmed: 20 % shorter is still the same episode.
    expect(isWrongMoreVideo(48 * 60, 60)).toBe(false);
    // Short runtimes need at least a 5-minute gap.
    expect(isWrongMoreVideo(7 * 60, 11)).toBe(false);
  });

  it("never flags without both lengths", () => {
    expect(isWrongMoreVideo(undefined, 24)).toBe(false);
    expect(isWrongMoreVideo(1500, undefined)).toBe(false);
    expect(isWrongMoreVideo(0, 24)).toBe(false);
    expect(isWrongMoreVideo(Number.NaN, 24)).toBe(false);
    expect(isWrongMoreVideo(1500, 0)).toBe(false);
  });
});
