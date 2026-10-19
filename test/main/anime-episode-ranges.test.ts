import { describe, expect, it } from "vitest";
import {
  animeEpisodeRanges,
  arcRanges,
  namedSeasonRanges,
  seasonRanges,
} from "../../src/main/anime-episode-ranges";
import type { AniZipEpisodeIndexRow } from "../../src/main/anizip";
import { pickStoryArcGroup, parseStoryArcs, type TmdbStoryArc } from "../../src/main/tmdb";

/** Episode N aired on day N of 2000 (one per day). */
const index = (
  count: number,
  season?: (n: number) => number | undefined,
): AniZipEpisodeIndexRow[] =>
  Array.from({ length: count }, (_, i) => {
    const number = i + 1;
    const tvdbSeason = season?.(number);
    return { number, airDate: date(number), ...(tvdbSeason ? { tvdbSeason } : {}) };
  });

function date(day: number): string {
  return new Date(Date.UTC(2000, 0, day)).toISOString().slice(0, 10);
}

const arc = (name: string, days: number[], seasonNumber = 1): TmdbStoryArc => ({
  name,
  episodes: days.map((day) => ({ airDate: date(day), seasonNumber })),
});

describe("arcRanges", () => {
  it("places arcs by air date and runs each until the next starts", () => {
    expect(
      arcRanges(
        [
          arc("Romance Dawn", [1, 2]),
          arc("Warship Island (Filler)", [3, 4]),
          arc("~ Sky arc ~", [5]),
        ],
        index(60),
        60,
      ),
    ).toEqual([
      { title: "Romance Dawn", start: 1, end: 2 },
      { title: "Warship Island", start: 3, end: 4, filler: true },
      { title: "Sky", start: 5, end: 60 },
    ]);
  });

  it("ignores specials, unmatched dates and duplicate starts", () => {
    const ranges = arcRanges(
      [
        arc("Special only", [10], 0),
        arc("A", [1]),
        arc("Unknown dates", [900]),
        arc("B", [20, 21]),
        arc("B again", [20]),
      ],
      index(60),
      60,
    );
    expect(ranges?.map((row) => [row.title, row.start, row.end])).toEqual([
      ["A", 1, 19],
      ["B", 20, 60],
    ]);
  });

  it("returns nothing for fewer than two placed arcs", () => {
    expect(arcRanges([arc("Only", [1])], index(60), 60)).toBeUndefined();
  });
});

describe("seasonRanges", () => {
  it("splits by TheTVDB season, folding specials into the season around them", () => {
    const ranges = seasonRanges(
      index(60, (n) => (n === 25 ? undefined : n <= 30 ? 1 : 2)),
      60,
    );
    expect(ranges).toEqual([
      { title: "Season 1", start: 1, end: 30 },
      { title: "Season 2", start: 31, end: 60 },
    ]);
  });
});

describe("animeEpisodeRanges", () => {
  const deps = {
    index: async () => ({ index: index(80, (n) => (n <= 40 ? 1 : 2)), tmdbId: 37854 }),
  };

  it("skips short entries without a request", async () => {
    let calls = 0;
    const result = await animeEpisodeRanges(
      { index: async () => ((calls += 1), { index: [] }) },
      { aniListId: 1, episodes: 24 },
    );
    expect(result).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("prefers TMDB arcs, using the Wikidata link over ani.zip's mapping", async () => {
    const asked: number[] = [];
    const result = await animeEpisodeRanges(
      {
        ...deps,
        tmdbTvId: () => 99,
        storyArcs: async (id) => (asked.push(id), [arc("A", [1]), arc("B", [50])]),
      },
      { aniListId: 21, episodes: 80 },
    );
    expect(asked).toEqual([99]);
    expect(result).toEqual({
      kind: "arc",
      ranges: [
        { title: "A", start: 1, end: 49 },
        { title: "B", start: 50, end: 80 },
      ],
    });
  });

  it("falls back to TheTVDB seasons when TMDB fails or has no arcs", async () => {
    const failing = await animeEpisodeRanges(
      { ...deps, storyArcs: async () => Promise.reject(new Error("down")) },
      { aniListId: 21, episodes: 80 },
    );
    expect(failing?.kind).toBe("season");
    const empty = await animeEpisodeRanges(
      { ...deps, storyArcs: async () => [] },
      { aniListId: 21, episodes: 80 },
    );
    expect(empty?.ranges.map((row) => row.title)).toEqual(["Season 1", "Season 2"]);
  });
});

describe("TMDB story-arc groups", () => {
  const group = (id: string, name: string, type = 5, description = "") => ({
    id,
    name,
    type,
    description,
  });

  it("prefers English arc lists and skips sagas and other languages", () => {
    expect(
      pickStoryArcGroup({
        results: [
          group("a1", "Arcs"),
          group("a2", "Sagas de Fairy Tail"),
          group("a3", "Arcs [ENG]"),
          group("a4", "Arcs [ENG] Compilation Edition"),
        ],
      }),
    ).toBe("a3");
    expect(
      pickStoryArcGroup({
        results: [group("b1", "French Arcs"), group("b2", "Story Arcs", 5, "In English")],
      }),
    ).toBe("b2");
    expect(
      pickStoryArcGroup({ results: [group("c1", "Arcs (No Filler)"), group("c2", "Story Arc")] }),
    ).toBe("c2");
    expect(pickStoryArcGroup({ results: [group("d1", "TVDB Order", 1)] })).toBeUndefined();
    expect(pickStoryArcGroup({ results: [group("e1", "ストーリー順 Arcs")] })).toBeUndefined();
  });

  it("parses arcs in order and drops malformed groups", () => {
    expect(
      parseStoryArcs({
        groups: [
          { name: "Second", order: 2, episodes: [{ air_date: "2000-01-02", season_number: 1 }] },
          { name: "First", order: 1, episodes: [{ air_date: "bad", season_number: 1 }] },
          { order: 3, episodes: [] },
        ],
      }),
    ).toEqual([
      { name: "First", episodes: [{ airDate: undefined, seasonNumber: 1 }] },
      { name: "Second", episodes: [{ airDate: "2000-01-02", seasonNumber: 1 }] },
    ]);
  });
});

describe("namedSeasonRanges", () => {
  const season = (number: number, name: string, episodeCount?: number, airDate?: string) => ({
    number,
    name,
    episodeCount,
    airDate,
  });

  it("lays TMDB's named seasons end to end when their counts match the entry", () => {
    expect(
      namedSeasonRanges(
        [
          season(0, "Specials", 39),
          season(1, "East Blue", 61, "1999-10-20"),
          season(2, "S2 • Whiskey Peak & Little Garden", 16),
          season(3, "Drum Island", 4),
        ],
        index(80),
        80,
      ),
    ).toEqual([
      { title: "East Blue", start: 1, end: 61 },
      { title: "Whiskey Peak & Little Garden", start: 62, end: 77 },
      { title: "Drum Island", start: 78, end: 80 },
    ]);
  });

  it("falls back to air dates, and ignores generic or mostly undated seasons", () => {
    // Counts do not add up (40 of 80): placed by first air date instead.
    expect(
      namedSeasonRanges(
        [season(1, "Arc One", 20, date(1)), season(2, "Arc Two", 20, date(51))],
        index(80),
        80,
      )?.map((row) => [row.title, row.start, row.end]),
    ).toEqual([
      ["Arc One", 1, 50],
      ["Arc Two", 51, 80],
    ]);
    expect(
      namedSeasonRanges([season(1, "Season 1", 40), season(2, "Season 2", 40)], index(80), 80),
    ).toBeUndefined();
    expect(
      namedSeasonRanges(
        [season(1, "A", 10, date(1)), season(2, "B", 10), season(3, "C", 10), season(4, "D", 10)],
        index(80),
        80,
      ),
    ).toBeUndefined();
  });

  it("is preferred over the story-arc list", async () => {
    const result = await animeEpisodeRanges(
      {
        index: async () => ({ index: index(80), tmdbId: 37854 }),
        tvSeasons: async () => [season(1, "East Blue", 40), season(2, "Alabasta", 40)],
        storyArcs: async () => {
          throw new Error("should not be asked");
        },
      },
      { aniListId: 21, episodes: 80 },
    );
    expect(result?.ranges.map((row) => row.title)).toEqual(["East Blue", "Alabasta"]);
  });
});
