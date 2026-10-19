import { describe, expect, it, vi } from "vitest";
import type { RecommendationSeedData } from "../../src/main/anilist/recommendation-seeds";
import { openAppDatabase } from "../../src/main/database";
import { parseMalExplore, type MalExploreItem } from "../../src/main/mal";
import { DiscoveryService } from "../../src/main/recommendations/discovery-service";
import {
  pickTryNew,
  rankHybrid,
  weightedRating,
  type HybridHistoryItem,
  type TryNewCandidate,
} from "../../src/main/recommendations/engine";
import { moreTryNewPool, preselectMal } from "../../src/main/recommendations/try-new-pools";
import { parseBestPicks } from "../../src/main/simkl/service";
import type { AniListMedia } from "../../src/shared/contracts";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 12);

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
    genres: ["Action"],
    tags: [],
    creators: [],
    averageScore: 70,
    popularity: 100_000,
    updatedAt: now,
    ...overrides,
  };
}
const liked = (features: RecommendationItemFeatures): HybridHistoryItem => ({
  features,
  affinity: 1,
  occurredAt: now,
});

/** A viewer who only watches Action and Romance. */
const history = [
  ...[1, 2, 3].map((id) => liked(item(id, { genres: ["Action"] }))),
  ...[4, 5].map((id) => liked(item(id, { genres: ["Romance"] }))),
];
/** Twelve different unfamiliar genres, so variety rules never block a full row. */
const NEW_GENRES = [
  "Drama",
  "Mystery",
  "Sports",
  "Horror",
  "Music",
  "Psychological",
  "Slice of Life",
  "Supernatural",
  "Mecha",
  "Comedy",
  "Thriller",
  "Sci-Fi",
];
const candidate = (
  id: number,
  overrides: Partial<RecommendationItemFeatures> = {},
): TryNewCandidate => ({
  features: item(id, {
    genres: [NEW_GENRES[(id - 100) % NEW_GENRES.length]],
    malScore: 8.4,
    ratingCount: 5_000,
    popularity: 40_000,
    startedOn: 20200101,
    origin: `C${id % 4}`,
    ...overrides,
  }),
});
const classic = candidate(200, {
  genres: ["Historical"],
  startedOn: 19950101,
  popularity: 9_000,
  malScore: 8.1,
});

describe("Try something new: rules", () => {
  it("returns exactly ten, with one obscure classic second, all outside the usual taste", () => {
    const pool = [...Array.from({ length: 14 }, (_, at) => candidate(100 + at)), classic];
    const picks = pickTryNew(history, pool, { now });
    expect(picks).toHaveLength(10);
    expect(
      picks.filter((pick) => pick.obscureClassic).map((pick) => pick.features.anilistId),
    ).toEqual([200]);
    expect(picks[1].features.anilistId).toBe(200);
    for (const pick of picks) expect(pick.newTastes.length).toBeGreaterThan(0);
    expect(picks.map((pick) => pick.features.anilistId)).not.toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5]),
    );
  });

  it("needs 50 raters and a good weighted rating, so a few loud votes do not count", () => {
    expect(weightedRating(item(1, { malScore: 9.5, ratingCount: 52 }))).toBeLessThan(
      weightedRating(item(2, { malScore: 8.6, ratingCount: 4_000 })),
    );
    const pool = [
      ...Array.from({ length: 12 }, (_, at) => candidate(100 + at)),
      classic,
      candidate(300, { ratingCount: 49, genres: ["Gourmet"] }),
      candidate(301, { malScore: 6.1, genres: ["Idols"] }),
    ];
    const ids = pickTryNew(history, pool, { now }).map((pick) => pick.features.anilistId);
    expect(ids).not.toContain(300);
    expect(ids).not.toContain(301);
  });

  it("skips titles made only of tastes the viewer already has", () => {
    const pool = [
      ...Array.from({ length: 12 }, (_, at) => candidate(100 + at)),
      classic,
      candidate(400, { genres: ["Action", "Romance"], malScore: 9.4 }),
    ];
    expect(pickTryNew(history, pool, { now }).map((pick) => pick.features.anilistId)).not.toContain(
      400,
    );
  });

  it("shows nothing rather than a half row, or a row without an obscure classic", () => {
    expect(
      pickTryNew(history, [...Array.from({ length: 6 }, (_, at) => candidate(100 + at)), classic], {
        now,
      }),
    ).toEqual([]);
    expect(
      pickTryNew(
        history,
        Array.from({ length: 14 }, (_, at) => candidate(100 + at)),
        { now },
      ),
    ).toEqual([]);
  });

  it("includes a documentary when asked, and rotates by day but not within a day", () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, at) => candidate(100 + at)),
      classic,
      candidate(500, { genres: ["Documentary"], malScore: 7.6 }),
    ];
    const today = pickTryNew(history, pool, { now, requireDocumentary: true });
    expect(today.some((pick) => pick.documentary)).toBe(true);
    expect(pickTryNew(history, pool, { now: now + 3_600_000 })).toEqual(
      pickTryNew(history, pool, { now }),
    );
    const days = new Set(
      Array.from({ length: 6 }, (_, day) =>
        pickTryNew(history, pool, { now: now + day * 86_400_000 })
          .map((pick) => pick.features.anilistId)
          .join(","),
      ),
    );
    expect(days.size).toBeGreaterThan(1);
  });
});

describe("Try something new: sources", () => {
  it("reads MyAnimeList rankings: safe-for-work only, comics only for manga", () => {
    const node = (id: number, extra: Record<string, unknown>) => ({
      node: {
        id,
        mean: 8.1,
        num_scoring_users: 900,
        num_list_users: 4_000,
        nsfw: "white",
        media_type: "manga",
        start_date: "1998-04-01",
        num_chapters: 40,
        genres: [{ name: "Avant Garde" }],
        ...extra,
      },
    });
    const items = parseMalExplore(
      {
        data: [
          node(1, {}),
          node(2, { nsfw: "gray" }),
          node(3, { media_type: "light_novel" }),
          node(4, { genres: [{ name: "Erotica" }] }),
        ],
      },
      "manga",
    );
    expect(items).toEqual([
      {
        malId: 1,
        mean: 8.1,
        raters: 900,
        members: 4_000,
        genres: ["Avant Garde"],
        year: 1998,
        mediaType: "manga",
        length: 40,
      },
    ]);
  });

  it("preselects up to 100 qualified, non-mainstream titles and keeps room for classics", () => {
    const mal = (malId: number, extra: Partial<MalExploreItem> = {}): MalExploreItem => ({
      malId,
      mean: 8,
      raters: 2_000,
      members: 20_000,
      genres: [],
      year: 2020,
      mediaType: "tv",
      ...extra,
    });
    const items = [
      ...Array.from({ length: 300 }, (_, at) => mal(at + 1)),
      mal(1_000, { members: 900_000 }),
      mal(1_001, { raters: 20 }),
      ...Array.from({ length: 20 }, (_, at) => mal(2_000 + at, { year: 1990, members: 5_000 })),
    ];
    const picked = preselectMal(items, "ANIME", now);
    expect(picked).toHaveLength(100);
    const ids = picked.map((row) => row.malId);
    expect(ids).not.toContain(1_000);
    expect(ids).not.toContain(1_001);
    expect(ids.filter((id) => id >= 2_000).length).toBeGreaterThanOrEqual(15);
    expect(preselectMal(items, "ANIME", now + 86_400_000).map((row) => row.malId)).not.toEqual(ids);
  });

  it("gathers TMDB pools and Simkl documentaries with their links; a failed source is skipped", async () => {
    const pool = vi.fn(async (type: "MOVIE" | "TV", kind: string) => {
      if (kind === "classic") throw new Error("down");
      return [item(type === "MOVIE" ? 10 : 20, { mediaType: type })];
    });
    const candidate = vi.fn(async (id: number) => item(id, { mediaType: "TV" }));
    const result = await moreTryNewPool(
      {
        pool,
        candidate,
        simklDocumentaries: async () => [
          { type: "TV", tmdbId: 20, link: "https://simkl.example/20" },
          { type: "TV", tmdbId: 30, link: "https://simkl.example/30" },
        ],
      },
      now,
    );
    expect(result.candidates.map((row) => row.features.anilistId).sort()).toEqual([10, 20, 30]);
    expect([...result.simklLinks.keys()].sort()).toEqual(["TV:20", "TV:30"]);
    expect(candidate).toHaveBeenCalledTimes(1);
  });

  it("reads Simkl best lists, including a bare null", () => {
    expect(parseBestPicks(null, "TV")).toEqual([]);
    expect(
      parseBestPicks(
        [{ ids: { tmdb: "42" } }, { show: { ids: { tmdb: 7 } } }, { ids: { tmdb: "x" } }],
        "TV",
      ),
    ).toEqual([
      { type: "TV", tmdbId: 42 },
      { type: "TV", tmdbId: 7 },
    ]);
  });
});

describe("Adaptive cross-section prior", () => {
  it("leans on other sections more while this section's history is thin", () => {
    const target = item(900, { mediaType: "MANGA", genres: ["Horror"] });
    const other = item(901, { mediaType: "MANGA", genres: ["Comedy"] });
    const animeTaste = Array.from({ length: 6 }, (_, at) =>
      liked(item(at + 1, { genres: ["Horror"] })),
    );
    const mangaTaste = [liked(item(800, { mediaType: "MANGA", genres: ["Comedy"] }))];
    const content = (shrink: number) =>
      rankHybrid({
        section: "MANGA",
        history: [...animeTaste, ...mangaTaste],
        candidates: [target, other],
        now,
        weights: { crossTypeShrink: shrink },
      }).find((row) => row.features.anilistId === 900)!.content;
    expect(content(20)).toBeGreaterThan(content(0));
  });
});

describe("Anime For You ends with the litmus row", () => {
  const media = (id: number): AniListMedia => ({
    id,
    type: "ANIME",
    title: `Title ${id}`,
    coverUrl: "",
    siteUrl: `https://anilist.co/anime/${id}`,
    totalProgress: 12,
  });

  it("adds ten Try something new picks last, apart from every other row", async () => {
    const db = openAppDatabase(":memory:");
    for (let id = 1; id <= 3; id++)
      db.recordActivity({ media: media(id), unit: 12, state: "completed" });
    const seeds = vi.fn(async (ids: number[]): Promise<RecommendationSeedData> => ({
      seeds: ids.map((id) =>
        item(id, { recommendations: [{ id: 60, mediaType: "ANIME", rating: 20 }] }),
      ),
      neighbors: [item(60)],
    }));
    const tryNew = vi.fn(async () => [
      ...Array.from({ length: 14 }, (_, at) => candidate(100 + at)),
      classic,
    ]);
    const service = new DiscoveryService({
      store: db.discovery,
      activity: () => db.listActivity(0),
      owner: () => 0,
      dashboard: () => undefined,
      seeds,
      trending: async () => [item(70), item(71)],
      tryNew,
      now: () => now,
    });
    try {
      const feed = await service.getForYou("ANIME");
      const last = feed.rows?.at(-1);
      expect(last?.tryNew).toBe(true);
      expect(last?.items).toHaveLength(10);
      expect(last?.items[1].reasonCodes[0]).toBe("obscure-classic");
      await service.getForYou("ANIME");
      expect(tryNew).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
});
