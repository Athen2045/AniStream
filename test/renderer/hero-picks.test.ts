import { describe, expect, it } from "vitest";
import {
  HERO_CACHE_MS,
  heroCacheState,
  mixHeroPicks,
  withTrendingSlide,
  type HeroCache,
} from "../../src/renderer/src/hero-picks";

const key = (item: string): string => item;

describe("personalized hero picks", () => {
  it("alternates For You with one title per Because-you row, without repeats", () => {
    const picks = mixHeroPicks(
      { reason: "For You", items: ["a", "b", "c"] },
      [
        { reason: "Because you watched X", items: ["a", "x1", "x2"] },
        { reason: "Because you watched Y", items: ["y1"] },
      ],
      key,
      6,
    );
    expect(picks.map((pick) => pick.item)).toEqual(["a", "x1", "b", "y1", "c", "x2"]);
    expect(picks[1].reason).toBe("Because you watched X");
  });

  it("fills from whichever source still has titles", () => {
    expect(
      mixHeroPicks({ reason: "For You", items: [] }, [{ reason: "R", items: ["r1", "r2"] }], key, 6)
        .length,
    ).toBe(2);
    expect(mixHeroPicks({ reason: "For You", items: ["a", "b"] }, [], key, 6).length).toBe(2);
  });

  it("keeps a set two days unless one of its titles was watched since", () => {
    const cache: HeroCache<string> = {
      owner: "1",
      savedAt: 1_000,
      slides: [
        { item: "a", reason: "For You" },
        { item: "b", reason: "For You" },
      ],
    };
    const never = (): boolean => false;
    expect(heroCacheState(cache, 1_000 + HERO_CACHE_MS - 1, never)).toBe("fresh");
    expect(heroCacheState(cache, 1_000 + HERO_CACHE_MS, never)).toBe("stale");
    expect(heroCacheState(cache, 2_000, (item, savedAt) => item === "b" && 1_500 > savedAt)).toBe(
      "retired",
    );
    expect(heroCacheState(undefined, 0, never)).toBe("retired");
  });

  it("adds one live Trending title as the third slide, skipping watched and repeated ones", () => {
    const personal = ["a", "b", "c", "d", "e", "f"];
    expect(withTrendingSlide(personal, ["b", "w", "t"], key, (item) => item === "w")).toEqual({
      items: ["a", "b", "t", "c", "d", "e"],
      trendingKey: "t",
    });
    expect(withTrendingSlide(["a", "b"], ["a"], key, () => false)).toEqual({ items: ["a", "b"] });
  });
});
