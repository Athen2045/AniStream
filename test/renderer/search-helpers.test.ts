import { describe, expect, it } from "vitest";
import {
  closestTitle,
  editDistance,
  highlightMatch,
  isConfidentMatch,
  searchNormalize,
} from "../../src/renderer/src/search-helpers";
import { parseRecentSearches } from "../../src/renderer/src/recent-searches";
import { normalizeSearchExtras } from "../../src/main/anilist/normalize";

describe("search helpers", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(searchNormalize("Sōsō no  Frieren!")).toBe("soso no frieren");
  });

  it("gives the top-result card only to a clear match", () => {
    expect(isConfidentMatch("one piece", "ONE PIECE")).toBe(true);
    expect(isConfidentMatch("Frieren", "Frieren: Beyond Journey's End")).toBe(true);
    expect(isConfidentMatch("Fri", "Frieren: Beyond Journey's End")).toBe(false);
    expect(isConfidentMatch("Journey", "Frieren: Beyond Journey's End")).toBe(false);
  });

  it("offers a 'did you mean' title only within two typos", () => {
    expect(editDistance("peice", "piece")).toBe(1);
    expect(closestTitle("one peice", ["ONE PIECE", "One Punch Man"])).toBe("ONE PIECE");
    expect(closestTitle("one peice", ["Cheating Craft", "001"])).toBeUndefined();
    expect(closestTitle("frirn", ["Sousou no Frieren"])).toBeUndefined();
  });

  it("splits a label around the typed part", () => {
    expect(highlightMatch("Sousou no Frieren", "frie")).toEqual(["Sousou no ", "Frie", "ren"]);
    expect(highlightMatch("ONE PIECE", "bleach")).toEqual(["ONE PIECE", "", ""]);
  });
});

describe("recent searches on the device", () => {
  it("keeps valid, distinct entries per section and drops the rest", () => {
    expect(
      parseRecentSearches({
        ANIME: ["Frieren", "frieren", "x", 3, " Dandadan "],
        MANGA: "nope",
        EXTRA: ["ignored"],
      }),
    ).toEqual({ ANIME: ["Frieren", "Dandadan"], MANGA: [], MORE: [] });
    expect(parseRecentSearches(null)).toEqual({ ANIME: [], MANGA: [], MORE: [] });
  });
});

describe("AniList search extras", () => {
  const response = {
    other: { media: [{ id: 1 }, { id: 2 }] },
    characters: {
      characters: [
        {
          id: 40,
          name: { full: "Luffy Monkey", alternative: ["Straw Hat"] },
          image: { medium: "https://s4.anilist.co/c.png" },
          media: { nodes: [{ title: { english: "ONE PIECE" } }] },
        },
        {
          id: 9,
          name: { full: "Arcueid Brunestud" },
          media: { nodes: [{ title: { romaji: "X" } }] },
        },
      ],
    },
    studios: {
      studios: [
        { id: 18, name: "Toei Animation", isAnimationStudio: true },
        { id: 99, name: "Toeic", isAnimationStudio: true },
      ],
    },
  };

  it("counts the other section and keeps only whole-word name matches", () => {
    const luffy = normalizeSearchExtras(response, "luffy", "ANIME");
    expect(luffy.otherType).toBe("MANGA");
    expect(luffy.otherCount).toBe(2);
    expect(luffy.people).toEqual([
      {
        kind: "character",
        id: 40,
        name: "Luffy Monkey",
        imageUrl: "https://s4.anilist.co/c.png",
        knownFor: "ONE PIECE",
      },
    ]);
    expect(normalizeSearchExtras(response, "Toei", "ANIME").people.map((row) => row.name)).toEqual([
      "Toei Animation",
    ]);
  });

  it("lists studios only for anime and survives malformed parts", () => {
    expect(normalizeSearchExtras(response, "Toei", "MANGA").people).toEqual([]);
    expect(normalizeSearchExtras({ characters: "bad", studios: 4 }, "x", "MANGA")).toEqual({
      otherType: "ANIME",
      otherCount: 0,
      otherLimit: 9,
      people: [],
    });
  });
});
