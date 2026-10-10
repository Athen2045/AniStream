import { describe, expect, it } from "vitest";
import {
  loadRecommendationSeeds,
  loadRecommendationTrending,
} from "../../src/main/anilist/recommendation-seeds";
import { openAppDatabase } from "../../src/main/database";
import { historyAffinities } from "../../src/main/recommendations/discovery-evidence";
import {
  buildSeedRows,
  pickHybrid,
  seedRowsHybrid,
  firstSeason,
  redirectEdges,
  buildThemeRow,
  eligibilityFilter,
  rankHybrid,
  selectHybrid,
  type HybridHistoryItem,
} from "../../src/main/recommendations/hybrid";
import type { AniListDashboard, AniListEntry } from "../../src/shared/contracts";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 4);

function item(
  id: number,
  overrides: Partial<RecommendationItemFeatures> = {},
): RecommendationItemFeatures {
  return {
    anilistId: id,
    mediaType: "ANIME",
    normalizedTitle: `Title ${id}`,
    titleTokens: [],
    synonyms: [],
    genres: [],
    tags: [],
    creators: [],
    averageScore: 70,
    popularity: 10_000,
    updatedAt: now,
    ...overrides,
  };
}

function liked(features: RecommendationItemFeatures, affinity = 1): HybridHistoryItem {
  return { features, affinity, occurredAt: now };
}

describe("hybrid ranker", () => {
  it("ranks recommendation-graph neighbors of liked titles above unrelated candidates", () => {
    const seed = item(1, { recommendations: [{ id: 10, mediaType: "ANIME", rating: 50 }] });
    const ranked = rankHybrid({
      section: "ANIME",
      history: [liked(seed)],
      candidates: [item(11, { popularity: 900_000, averageScore: 90 }), item(10)],
      now,
    });
    expect(ranked.map((row) => row.features.anilistId)).toEqual([10, 11]);
    expect(ranked[0]).toMatchObject({ seedKey: "ANIME:1", graph: 1 });
  });

  it("uses IDF content similarity and lets dislikes push matching candidates down", () => {
    const tag = (name: string) => ({ id: name.length, name, rank: 90 });
    const history = [
      liked(item(1, { genres: ["Drama"], tags: [tag("Time Travel")] })),
      liked(item(2, { genres: ["Drama"], tags: [tag("Idol")] }), -1),
    ];
    const ranked = rankHybrid({
      section: "ANIME",
      history,
      candidates: [
        item(10, { genres: ["Drama"], tags: [tag("Idol")] }),
        item(11, { genres: ["Drama"], tags: [tag("Time Travel")] }),
      ],
      now,
    });
    expect(ranked[0].features.anilistId).toBe(11);
    expect(ranked[1].content).toBe(0);
  });

  it("weights the other media type as a weaker prior and ignores other-type candidates", () => {
    const manga = item(1, {
      mediaType: "MANGA",
      recommendations: [{ id: 10, mediaType: "ANIME", rating: 10 }],
    });
    const anime = item(2, { recommendations: [{ id: 11, mediaType: "ANIME", rating: 10 }] });
    const ranked = rankHybrid({
      section: "ANIME",
      history: [liked(manga), liked(anime)],
      candidates: [item(10), item(11), item(12, { mediaType: "MANGA" })],
      now,
    });
    expect(ranked.map((row) => row.features.anilistId)).toEqual([11, 10]);
  });

  it("fades repeats of one seed instead of cutting them off, and labels the seed title", () => {
    const seed = item(1, {
      recommendations: [10, 11, 12, 13, 14, 15].map((id) => ({
        id,
        mediaType: "ANIME" as const,
        rating: 9,
      })),
    });
    const history = [liked(seed)];
    const ranked = rankHybrid({
      section: "ANIME",
      history,
      candidates: [10, 11, 12, 13, 14, 15, 20].map((id) => item(id)),
      now,
    });
    // Same-seed picks lose a little more each time (X's diversity decay), so the unrelated title
    // overtakes the fifth one rather than waiting behind every neighbour.
    const picked = selectHybrid(ranked, history, 6);
    expect(picked.map((row) => row.anilistId)).toEqual([10, 11, 12, 13, 20, 14]);
    expect(picked[0]).toMatchObject({ relatedTo: 1, relatedTitle: "Title 1" });
    expect(picked[4].relatedTo).toBeUndefined();
  });
});

describe("history affinity", () => {
  const entry = (id: number, patch: Partial<AniListEntry>): AniListEntry => ({
    id,
    status: "COMPLETED",
    score: 0,
    progress: 12,
    repeat: 0,
    updatedAt: now / 1000,
    media: { id, type: "ANIME", title: `Title ${id}` } as AniListEntry["media"],
    ...patch,
  });
  it("scores relative to the viewer mean, treats dropped as negative and ignores planning", () => {
    const dashboard = {
      profile: { id: 1 },
      animeLists: [
        {
          name: "All",
          isCustomList: false,
          entries: [
            entry(1, { score: 10 }),
            entry(2, { score: 7 }),
            entry(3, { status: "DROPPED", score: 0 }),
            entry(4, { status: "PLANNING", progress: 0 }),
            entry(5, {}),
          ],
        },
      ],
      mangaLists: [],
    } as unknown as AniListDashboard;
    const rows = new Map(historyAffinities([], dashboard).map((row) => [row.anilistId, row]));
    expect(rows.get(1)!.affinity).toBeGreaterThan(rows.get(2)!.affinity);
    expect(rows.get(3)!.affinity).toBeLessThan(0);
    expect(rows.has(4)).toBe(false);
    expect(rows.get(5)!.affinity).toBe(0.5);
  });
});

describe("AniList seed adapter", () => {
  it("normalizes edges, neighbors, identity staff and tags at the edge", async () => {
    const neighbor = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      type: "ANIME",
      title: { userPreferred: `N${id}` },
      coverImage: { large: "http://insecure.example/cover.jpg" },
      genres: ["Drama"],
      ...extra,
    });
    const request = async () => ({
      Page: {
        media: [
          {
            ...neighbor(1),
            tags: [
              { id: 1, name: "Twist", rank: 80, isMediaSpoiler: true },
              { id: 2, name: "School", rank: 60, isMediaSpoiler: false },
            ],
            staff: {
              edges: [
                { role: "Original Creator", node: { id: 7, name: { full: "Author" } } },
                { role: "Theme Song Performance", node: { id: 8, name: { full: "Singer" } } },
              ],
            },
            recommendations: {
              nodes: [
                { rating: 30, mediaRecommendation: neighbor(10, { isAdult: true }) },
                { rating: 0, mediaRecommendation: neighbor(11) },
                { rating: 5, mediaRecommendation: neighbor(1) },
                { rating: 5, mediaRecommendation: { id: "bad" } },
              ],
            },
          },
        ],
      },
    });
    const data = await loadRecommendationSeeds(request, [1], now);
    expect(data.seeds).toHaveLength(1);
    const [seed] = data.seeds;
    expect(seed.recommendations).toEqual([{ id: 10, mediaType: "ANIME", rating: 30 }]);
    expect(seed.creators).toEqual([{ id: 7, name: "Author", role: "STAFF" }]);
    expect(seed.tags.map((tag) => [tag.name, tag.rank])).toEqual([
      ["School", 60],
      ["Twist", 40],
    ]);
    expect(seed.coverUrl).toBeUndefined();
    expect(data.neighbors).toEqual([expect.objectContaining({ anilistId: 10, isAdult: true })]);
  });
});

describe("discovery feature store", () => {
  it("keeps a seed's cached edges when the same title is saved again as a neighbor", () => {
    const db = openAppDatabase(":memory:");
    try {
      const edges = [{ id: 10, mediaType: "ANIME" as const, rating: 5 }];
      db.discovery.saveFeatures([item(1, { recommendations: edges })]);
      db.discovery.saveFeatures([item(1, { averageScore: 91 })]);
      expect(db.discovery.features([1])[0]).toMatchObject({
        averageScore: 91,
        recommendations: edges,
      });
    } finally {
      db.close();
    }
  });
});

describe("eligibility", () => {
  const anime = (id: number, relations: RecommendationItemFeatures["relations"] = []) =>
    item(id, { relations });
  const manga = (id: number, relations: RecommendationItemFeatures["relations"] = []) =>
    item(id, { mediaType: "MANGA", relations });

  it("hides the same work in the other section in either relation direction", () => {
    const watchedAnime = anime(1, [{ id: 50, mediaType: "MANGA", relationType: "SOURCE" }]);
    const eligible = eligibilityFilter([watchedAnime], new Set([1]));
    expect(eligible(manga(50))).toBe(false); // listed on the watched anime
    expect(eligible(manga(51, [{ id: 1, mediaType: "ANIME", relationType: "ADAPTATION" }]))).toBe(
      false,
    ); // listed on the candidate
    expect(eligible(manga(52, [{ id: 99, mediaType: "ANIME", relationType: "ADAPTATION" }]))).toBe(
      true,
    ); // adaptation the viewer never started
    expect(eligible(manga(53))).toBe(true);
  });

  it("only offers later entries whose prequel or parent was started", () => {
    const eligible = eligibilityFilter([], new Set([1]));
    expect(eligible(anime(10, [{ id: 9, mediaType: "ANIME", relationType: "PREQUEL" }]))).toBe(
      false,
    );
    expect(eligible(anime(11, [{ id: 9, mediaType: "ANIME", relationType: "PARENT" }]))).toBe(
      false,
    );
    expect(eligible(anime(12, [{ id: 1, mediaType: "ANIME", relationType: "PREQUEL" }]))).toBe(
      true,
    );
    // A manga prequel does not gate an anime, and unknown relations allow the title.
    expect(eligible(anime(13, [{ id: 9, mediaType: "MANGA", relationType: "PREQUEL" }]))).toBe(
      true,
    );
    expect(eligible(item(14))).toBe(true);
  });
});

describe("seed rows and exploration", () => {
  const edges = (...ids: number[]) =>
    ids.map((id) => ({ id, mediaType: "ANIME" as const, rating: 10 }));

  it("builds recent-first rows without repeating shown titles or thin rows", () => {
    const old = {
      ...liked(item(1, { recommendations: edges(10, 11, 12, 13, 14) })),
      occurredAt: now - 9e9,
    };
    const recent = liked(item(2, { recommendations: edges(10, 20, 21, 22, 23) }));
    const thin = liked(item(3, { recommendations: edges(30) }));
    const history = [old, recent, thin];
    const scored = rankHybrid({
      section: "ANIME",
      history,
      candidates: [10, 11, 12, 13, 14, 20, 21, 22, 23, 30].map((id) => item(id)),
      now,
    });
    const rows = buildSeedRows(scored, history, "ANIME", new Set([20]), {
      minItems: 4,
      random: () => 0.999,
    });
    expect(rows.map((row) => row.seedTitle)).toEqual(["Title 2", "Title 1"]);
    expect(rows[0].items.map((row) => row.anilistId).sort()).toEqual([10, 21, 22, 23]);
    expect(rows[1].items.map((row) => row.anilistId).sort()).toEqual([11, 12, 13, 14]);
    // 10 belongs to the newer row, so the older row keeps the remaining four.
    expect(rows[0].items.every((row) => row.relatedTitle === "Title 2")).toBe(true);
  });

  it("rotates which liked titles seed the rows from load to load", () => {
    const history = range(1, 7).map((id) =>
      liked(item(id, { recommendations: edges(...range(id * 10, id * 10 + 6)) })),
    );
    const scored = rankHybrid({
      section: "ANIME",
      history,
      candidates: range(10, 70).map((id) => item(id)),
      now,
    });
    const seeds = (random: () => number) =>
      buildSeedRows(scored, history, "ANIME", new Set(), { minItems: 6, random }).map(
        (row) => row.seedId,
      );
    const first = seeds(() => 0.999);
    const second = seeds(() => 0);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(second).not.toEqual(first);
  });

  it("keeps a row in its seed's language and lets a rare language lift the rail", () => {
    const drama = { genres: ["Drama"] };
    const seed = liked(
      item(1, { ...drama, origin: "ml", recommendations: edges(10, 11, 12, 20, 21, 22) }),
    );
    const malayalam = range(10, 18).map((id) => item(id, { ...drama, origin: "ml" }));
    const english = range(20, 30).map((id) =>
      item(id, { ...drama, origin: "en", popularity: 900_000, averageScore: 85 }),
    );
    const scored = rankHybrid({
      section: "ANIME",
      history: [seed],
      candidates: [...english, ...malayalam],
      now,
    });
    const [row] = buildSeedRows(scored, [seed], "ANIME", new Set(), { random: () => 0.999 });
    expect(row.items.length).toBeGreaterThanOrEqual(6);
    expect(row.items.every((pick) => pick.anilistId >= 10 && pick.anilistId < 18)).toBe(true);
    // Same-language titles outrank far more popular English ones on content.
    const contentOf = (id: number) => scored.find((row) => row.features.anilistId === id)!.content;
    expect(contentOf(13)).toBeGreaterThan(contentOf(23));
  });

  it("builds a rotating theme row from themes shared by liked titles", () => {
    const heist = { id: 7, name: "heist", rank: 70 };
    const loop = { id: 8, name: "Time Loop", rank: 90 };
    const history = [
      liked(item(1, { tags: [heist, loop] })),
      liked(item(2, { tags: [heist] })),
      liked(item(3, { tags: [loop] })),
      liked(item(4, { tags: [{ id: 9, name: "Once Only", rank: 90 }] })),
    ];
    const candidates = [
      ...range(10, 17).map((id) => item(id, { tags: [heist] })),
      ...range(20, 27).map((id) => item(id, { tags: [loop] })),
      ...range(30, 37).map((id) => item(id, { tags: [{ id: 9, name: "Once Only", rank: 90 }] })),
    ];
    const scored = rankHybrid({ section: "ANIME", history, candidates, now });
    const themes = [0, 0.999].map((value) =>
      buildThemeRow(scored, history, "ANIME", new Set(), { random: () => value })!,
    );
    expect(themes.map((row) => row.theme).sort()).toEqual(["Heist", "Time Loop"]);
    const heistRow = themes.find((row) => row.theme === "Heist")!;
    expect(heistRow.items.every((pick) => pick.anilistId >= 10 && pick.anilistId < 17)).toBe(true);
    expect(buildThemeRow(scored, history, "ANIME", new Set(range(10, 37)))).toBeUndefined();
  });

  it("reserves the seventh card for a well-rated title outside the usual taste", () => {
    const tag = { id: 1, name: "Mecha", rank: 90 };
    // Four seeds with three neighbors each, so the per-seed cap does not pull in the outsider.
    const history = [0, 1, 2, 3].map((seed) =>
      liked(
        item(seed + 1, {
          tags: [tag],
          recommendations: edges(...range(10 + seed * 3, 13 + seed * 3)),
        }),
      ),
    );
    const similar = range(10, 22).map((id) => item(id, { tags: [tag] }));
    const outsider = item(99, { genres: ["Slice of Life"], averageScore: 88 });
    const weak = item(98, { genres: ["Sports"], averageScore: 60 });
    const scored = rankHybrid({
      section: "ANIME",
      history,
      candidates: [...similar, outsider, weak],
      now,
    });
    const picked = selectHybrid(scored, history, 10);
    expect(picked).toHaveLength(10);
    expect(picked[6]).toMatchObject({ anilistId: 99 });
    expect(picked[6].reasonCodes[0]).toBe("explore-more");
    expect(picked.some((row) => row.anilistId === 98)).toBe(false);
  });
});

describe("seed row content fill", () => {
  it("tops a thin row up with titles closest in content to its seed, above a floor", () => {
    const mecha = { id: 1, name: "Mecha", rank: 95 };
    const seed = liked(
      item(1, {
        genres: ["Action"],
        tags: [mecha],
        recommendations: [10, 11].map((id) => ({ id, mediaType: "ANIME" as const, rating: 9 })),
      }),
    );
    const like = (id: number) => item(id, { genres: ["Action"], tags: [mecha] });
    const unrelated = (id: number) => item(id, { genres: ["Romance"] });
    const scored = rankHybrid({
      section: "ANIME",
      history: [seed],
      candidates: [10, 11]
        .map((id) => item(id))
        .concat([20, 21, 22, 23].map(like), [30, 31].map(unrelated)),
      now,
    });
    const [row] = buildSeedRows(scored, [seed], "ANIME", new Set());
    expect(
      row.items
        .slice(0, 2)
        .map((r) => r.anilistId)
        .sort(),
    ).toEqual([10, 11]);
    expect(row.items.map((r) => r.anilistId)).toHaveLength(6);
    expect(row.items.some((r) => r.anilistId >= 30)).toBe(false);
    expect(row.items.every((r) => r.relatedTitle === "Title 1")).toBe(true);
    // Without enough similar titles the row is skipped rather than padded with unrelated ones.
    expect(
      buildSeedRows(
        scored.filter((r) => r.features.anilistId !== 23),
        [seed],
        "ANIME",
        new Set(),
      ),
    ).toEqual([]);
  });
});

describe("AniList relations and trending edge", () => {
  it("keeps only exact, known relation types and rejects malformed trending pages", async () => {
    const request = async () => ({
      Page: {
        media: [
          {
            id: 5,
            type: "ANIME",
            relations: {
              edges: [
                { relationType: "PREQUEL", node: { id: 4, type: "ANIME" } },
                { relationType: "CHARACTER", node: { id: 6, type: "ANIME" } },
                { relationType: "SOURCE", node: { id: "7", type: "MANGA" } },
              ],
            },
          },
          { id: 8, type: "MANGA" },
        ],
      },
    });
    const items = await loadRecommendationTrending(request, "ANIME", now);
    expect(items.map((row) => row.anilistId)).toEqual([5]);
    expect(items[0].relations).toEqual([{ id: 4, mediaType: "ANIME", relationType: "PREQUEL" }]);
    await expect(loadRecommendationTrending(async () => ({}), "ANIME")).rejects.toThrow(/invalid/);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}

describe("first-season redirect", () => {
  const item = (id: number, startedOn: number | undefined, ...prequels: number[]) =>
    ({
      anilistId: id,
      mediaType: "ANIME",
      normalizedTitle: `T${id}`,
      titleTokens: [],
      synonyms: [],
      genres: [],
      tags: [],
      creators: [],
      updatedAt: 0,
      startedOn,
      relations: prequels.map((prequel) => ({
        id: prequel,
        mediaType: "ANIME",
        relationType: "PREQUEL",
      })),
    }) as RecommendationItemFeatures;

  it("walks earlier-released prequels to where the viewer would begin", () => {
    const known = new Map([
      [1, item(1, 20100400)],
      [2, item(2, 20120700, 1)],
      [3, item(3, 20140100, 2)],
    ]);
    const lookup = (id: number) => known.get(id);
    expect(firstSeason(known.get(3)!, lookup, new Set())).toEqual({
      entry: known.get(1),
      storyPrequels: [],
    });
    // Season 1 watched: season 2 is next.
    expect(firstSeason(known.get(3)!, lookup, new Set([1]))).toEqual({
      entry: known.get(2),
      storyPrequels: [],
    });
    expect(firstSeason(known.get(1)!, lookup, new Set())).toBeUndefined();
    expect(firstSeason(item(9, 20200000, 8), lookup, new Set())).toEqual({ missing: 8 });
    // A cached row without a release date is refetched first.
    expect(firstSeason(item(9, undefined, 1), lookup, new Set())).toEqual({ missing: 9 });
  });

  it("does not send newcomers to a prequel made later (story order)", () => {
    // Main series (2013) whose AniList prequel is a 2016 arc, plus a 2015 "starting days" movie.
    const known = new Map([
      [10, item(10, 20130705, 11, 12)],
      [11, item(11, 20160711)],
      [12, item(12, 20151205)],
      [13, item(13, 20170101, 10)],
    ]);
    const lookup = (id: number) => known.get(id);
    expect(firstSeason(known.get(10)!, lookup, new Set())).toEqual({
      entry: known.get(10),
      storyPrequels: [11, 12],
    });
    expect(firstSeason(known.get(13)!, lookup, new Set())).toEqual({
      entry: known.get(10),
      storyPrequels: [11, 12],
    });
  });

  it("lets story prequels through eligibility but still blocks real earlier seasons", () => {
    const eligible = eligibilityFilter([], new Set());
    expect(eligible(item(10, 20130705, 11))).toBe(false);
    expect(eligible(item(10, 20130705, 11), [11])).toBe(true);
  });

  it("moves similar-to edges to the first season, keeping the strongest", () => {
    const history = [
      {
        features: {
          ...item(100, 20000000),
          recommendations: [
            { id: 3, mediaType: "ANIME" as const, rating: 40 },
            { id: 1, mediaType: "ANIME" as const, rating: 10 },
          ],
        },
        affinity: 1,
        occurredAt: 0,
      },
    ];
    expect(redirectEdges(history, new Map([[3, 1]]))[0].features.recommendations).toEqual([
      { id: 1, mediaType: "ANIME", rating: 40 },
    ]);
    expect(redirectEdges(history, new Map())).toBe(history);
  });
});

describe("More: movies and shows together", () => {
  const movie = (id: number, overrides: Partial<RecommendationItemFeatures> = {}) =>
    item(id, { mediaType: "MOVIE", genres: ["Crime", "Thriller"], ...overrides });
  const show = (id: number, overrides: Partial<RecommendationItemFeatures> = {}) =>
    item(id, { mediaType: "TV", genres: ["Crime", "Thriller"], ...overrides });
  const movieEdges = (...ids: number[]) =>
    ids.map((id) => ({ id, mediaType: "MOVIE" as const, rating: 10 }));

  it("puts the closest shows into a movie's row, spread out, in place of its weakest titles", () => {
    const seed = liked(movie(1, { recommendations: movieEdges(...range(10, 20)) }));
    const scored = rankHybrid({
      section: "MORE",
      history: [seed],
      candidates: [
        ...range(10, 20).map((id) => movie(id)),
        show(50),
        show(51),
        show(52, { genres: ["Kids"] }),
      ],
      now,
    });
    const [row] = seedRowsHybrid(scored, [seed], "MORE", new Set(), {
      random: () => 0.999,
      crossType: 3,
    });
    const types = row.items.map((pick) => pick.features.mediaType);
    expect(types).toHaveLength(10);
    // The unrelated kids' show stays out; the two crime shows sit at slots 3 and 6.
    expect(types.filter((type) => type === "TV")).toHaveLength(2);
    expect(types[2]).toBe("TV");
    expect(types[5]).toBe("TV");
    // Without the option rows stay single-type, as Anime and Manga rows do.
    const [plain] = seedRowsHybrid(scored, [seed], "MORE", new Set(), { random: () => 0.999 });
    expect(plain.items.every((pick) => pick.features.mediaType === "MOVIE")).toBe(true);
  });

  it("gives For You at least three of each type when they rank close enough", () => {
    // Four liked movies, three movie neighbours each: twelve strong movies before any show.
    const seeds = range(1, 5).map((seed) =>
      liked(movie(seed, { recommendations: movieEdges(...range(seed * 10, seed * 10 + 3)) })),
    );
    const scored = rankHybrid({
      section: "MORE",
      history: seeds,
      candidates: [
        ...range(1, 5).flatMap((seed) => range(seed * 10, seed * 10 + 3).map((id) => movie(id))),
        ...range(50, 54).map((id) => show(id)),
      ],
      now,
    });
    const tv = (picks: { features: RecommendationItemFeatures }[]) =>
      picks.filter((pick) => pick.features.mediaType === "TV").length;
    expect(tv(pickHybrid(scored, seeds, 10))).toBeLessThan(3);
    const balanced = pickHybrid(scored, seeds, 10, { minPerType: 3 });
    expect(tv(balanced)).toBe(3);
    expect(balanced).toHaveLength(10);
  });

  it("counts a show already filled into a short row toward its cross-type slots", () => {
    const seed = liked(movie(1, { recommendations: movieEdges(...range(10, 19)) }));
    const scored = rankHybrid({
      section: "MORE",
      history: [seed],
      candidates: [...range(10, 19).map((id) => movie(id)), show(50), show(51)],
      now,
    });
    const [row] = seedRowsHybrid(scored, [seed], "MORE", new Set(), {
      random: () => 0.999,
      crossType: 3,
    });
    expect(row.items.filter((pick) => pick.features.mediaType === "TV")).toHaveLength(2);
  });
});
