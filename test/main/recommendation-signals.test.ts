import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import type { RecommendationSeedData } from "../../src/main/anilist/recommendation-seeds";
import { DiscoveryService } from "../../src/main/recommendations/discovery-service";
import {
  adjustScores,
  franchiseKeys,
  isHidden,
  pickHybrid,
  rankHybrid,
  tasteRetrieval,
  type HybridHistoryItem,
} from "../../src/main/recommendations/engine";
import { createMoreDiscoveryStore } from "../../src/main/recommendations/stores/more-discovery-store";
import { normalizeHiddenTags } from "../../src/main/recommendations/stores/personalization-store";
import type { AniListMedia } from "../../src/shared/contracts";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 10);
const day = 86_400_000;

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
    genres: ["Drama"],
    tags: [],
    creators: [],
    averageScore: 70,
    popularity: 10_000,
    updatedAt: now,
    ...overrides,
  };
}
const liked = (features: RecommendationItemFeatures, affinity = 1): HybridHistoryItem => ({
  features,
  affinity,
  occurredAt: now,
});

describe("score adjustments (ignored picks, freshness, continuation)", () => {
  const scored = rankHybrid({
    section: "ANIME",
    history: [liked(item(1))],
    candidates: [item(10), item(11), item(12), item(13)],
    now,
  });
  const base = new Map(scored.map((row) => [row.features.anilistId, row.rawScore]));
  const score = (rows: typeof scored, id: number) =>
    rows.find((row) => row.features.anilistId === id)!.rawScore;

  it("fades titles shown on three or more days without being opened, down to a floor", () => {
    const adjusted = adjustScores(scored, {
      now,
      ignored: new Map([
        ["ANIME:10", 2],
        ["ANIME:11", 3],
        ["ANIME:12", 20],
      ]),
    });
    expect(score(adjusted, 10)).toBeCloseTo(base.get(10)!);
    expect(score(adjusted, 11)).toBeCloseTo(base.get(11)! * 0.8);
    expect(score(adjusted, 12)).toBeCloseTo(base.get(12)! * 0.35);
  });

  it("lifts airing and recent titles, and the next season of a liked show most", () => {
    const fresh = rankHybrid({
      section: "ANIME",
      history: [liked(item(1))],
      candidates: [
        item(20, { status: "RELEASING" }),
        item(21, { startedOn: 20260801, status: "FINISHED" }),
        item(22, { startedOn: 20190101, status: "FINISHED" }),
        item(23, { status: "NOT_YET_RELEASED", startedOn: 20270101 }),
      ],
      now,
    });
    const before = new Map(fresh.map((row) => [row.features.anilistId, row.rawScore]));
    const adjusted = adjustScores(fresh, { now, continuation: new Set(["ANIME:22"]) });
    expect(score(adjusted, 20)).toBeCloseTo(before.get(20)! * 1.12);
    expect(score(adjusted, 21)).toBeCloseTo(before.get(21)! * 1.08);
    expect(score(adjusted, 22)).toBeCloseTo(before.get(22)! * 1.25);
    expect(score(adjusted, 23)).toBeCloseTo(before.get(23)!);
  });
});

describe("franchise grouping, soft diversity and calibration", () => {
  it("groups titles joined by sequel links or a film collection", () => {
    const groups = franchiseKeys([
      item(1, { relations: [{ id: 2, mediaType: "ANIME", relationType: "SEQUEL" }] }),
      item(2, { relations: [{ id: 3, mediaType: "ANIME", relationType: "SEQUEL" }] }),
      item(3),
      item(9),
      item(50, { mediaType: "MOVIE", collectionId: 7 }),
      item(51, { mediaType: "MOVIE", collectionId: 7 }),
    ]);
    expect(groups.get("ANIME:1")).toBe(groups.get("ANIME:2"));
    expect(groups.has("ANIME:9")).toBe(false);
    expect(groups.get("MOVIE:50")).toBe(groups.get("MOVIE:51"));
  });

  it("lets one franchise take a slot early, then makes room for others", () => {
    const seed = item(1, {
      recommendations: [10, 11, 12, 20].map((id) => ({
        id,
        mediaType: "ANIME" as const,
        rating: 9,
      })),
    });
    const sequel = (id: number, next?: number) =>
      item(id, {
        relations: next ? [{ id: next, mediaType: "ANIME", relationType: "SEQUEL" }] : [],
      });
    const scored = rankHybrid({
      section: "ANIME",
      history: [liked(seed)],
      candidates: [sequel(10, 11), sequel(11, 12), sequel(12), item(20)],
      now,
    });
    const ids = pickHybrid(scored, [liked(seed)], 3).map((pick) => pick.features.anilistId);
    // One franchise (10 → 11 → 12) would fill the rail; the unrelated title takes a slot.
    expect(ids).toContain(20);
  });

  it("follows the genre mix of the history instead of only its strongest taste", () => {
    const history = [
      liked(item(1, { genres: ["Romance"] })),
      liked(item(2, { genres: ["Romance"] })),
      liked(item(3, { genres: ["Action"] })),
    ];
    const candidates = [
      ...[10, 11, 12, 13, 14].map((id) => item(id, { genres: ["Romance"], averageScore: 85 })),
      item(20, { genres: ["Action"], averageScore: 70 }),
    ];
    const scored = rankHybrid({ section: "ANIME", history, candidates, now });
    const genresOf = (picks: ReturnType<typeof pickHybrid>) =>
      picks.map((pick) => pick.features.genres[0]);
    expect(genresOf(pickHybrid(scored, history, 3))).not.toContain("Action");
    expect(genresOf(pickHybrid(scored, history, 3, { calibrate: 0.3 }))).toContain("Action");
  });
});

describe("taste retrieval and hidden genres", () => {
  it("finds cached titles closest to liked titles and skips the history itself", () => {
    const history = [
      liked(item(1, { genres: ["Horror"], tags: [{ id: 1, name: "Gore", rank: 90 }] })),
    ];
    const pool = [
      item(1),
      item(10, { genres: ["Horror"], tags: [{ id: 1, name: "Gore", rank: 80 }] }),
      item(11, { genres: ["Comedy"] }),
    ];
    expect(tasteRetrieval(history, pool, 5).map((row) => row.anilistId)).toEqual([10]);
  });

  it("hides by genre, or by a central tag only", () => {
    const hidden = new Set(["ecchi", "isekai"]);
    expect(isHidden(item(1, { genres: ["Ecchi"] }), hidden)).toBe(true);
    expect(isHidden(item(2, { tags: [{ id: 1, name: "Isekai", rank: 80 }] }), hidden)).toBe(true);
    expect(isHidden(item(3, { tags: [{ id: 1, name: "Isekai", rank: 20 }] }), hidden)).toBe(false);
    expect(isHidden(item(4), new Set())).toBe(false);
    expect(normalizeHiddenTags([" Ecchi ", "ecchi", 3, "", "Horror"])).toEqual(["Ecchi", "Horror"]);
  });
});

describe("More feature cache", () => {
  it("keeps a seed's film series when the film is saved again as a neighbour", () => {
    const db = new Database(":memory:");
    try {
      const store = createMoreDiscoveryStore(db);
      const film = item(5, { mediaType: "MOVIE" });
      store.saveFeatures([
        { ...film, collectionId: 70, recommendations: [{ id: 6, mediaType: "MOVIE", rating: 9 }] },
      ]);
      store.saveFeatures([film]);
      expect(store.features(["MOVIE:5"])[0]).toMatchObject({ collectionId: 70 });
    } finally {
      db.close();
    }
  });
});

describe("shown-but-ignored memory", () => {
  it("counts days per title for More, once a day, and forgets a title once its page opens", () => {
    const db = new Database(":memory:");
    try {
      const store = createMoreDiscoveryStore(db);
      store.recordShown(["MOVIE:1", "MOVIE:2"], now - 2 * day);
      store.recordShown(["MOVIE:1"], now - day);
      store.recordShown(["MOVIE:1", "MOVIE:1"], now - day + 1000);
      store.recordShown(["MOVIE:1"], now);
      expect(store.ignoredDays(now - 30 * day)).toEqual(
        new Map([
          ["MOVIE:1", 3],
          ["MOVIE:2", 1],
        ]),
      );
      store.markOpened("MOVIE:1");
      expect(store.ignoredDays(now - 30 * day).has("MOVIE:1")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("counts AniList impressions per day since the title was last opened from For You", () => {
    const db = openAppDatabase(":memory:");
    try {
      const result = {
        anilistId: 10,
        mediaType: "ANIME" as const,
        title: "T",
        score: 50,
        reasonCodes: [],
      };
      for (const offset of [5, 4, 3, 1])
        db.discovery.impression(7, `r${offset}`, result, 0, now - offset * day);
      expect(db.discovery.ignoredDays(7, now - 30 * day).get(10)).toBe(4);
      db.discovery.feedback(7, result, "explore", now - 2 * day);
      expect(db.discovery.ignoredDays(7, now - 30 * day).get(10)).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("Anime For You with the new signals", () => {
  const media = (id: number): AniListMedia => ({
    id,
    type: "ANIME",
    title: `Title ${id}`,
    coverUrl: "",
    siteUrl: `https://anilist.co/anime/${id}`,
    totalProgress: 12,
  });

  it("adds a next-seasons row from liked shows and keeps hidden genres out", async () => {
    const db = openAppDatabase(":memory:");
    for (let id = 1; id <= 3; id++)
      db.recordActivity({ media: media(id), unit: 12, state: "completed" });
    // Every liked show has a released sequel (100 + id) and points at an Ecchi title (50).
    const seeds = vi.fn(async (ids: number[]): Promise<RecommendationSeedData> => ({
      seeds: ids.map((id) =>
        id >= 100
          ? item(id, {
              status: "FINISHED",
              relations: [{ id: id - 100, mediaType: "ANIME", relationType: "PREQUEL" }],
            })
          : item(id, {
              recommendations: [
                { id: 50, mediaType: "ANIME", rating: 30 },
                { id: 60, mediaType: "ANIME", rating: 20 },
              ],
              relations: [{ id: 100 + id, mediaType: "ANIME", relationType: "SEQUEL" }],
            }),
      ),
      neighbors: [item(50, { genres: ["Ecchi"] }), item(60)],
    }));
    const service = new DiscoveryService({
      store: db.discovery,
      activity: () => db.listActivity(0),
      owner: () => 0,
      dashboard: () => undefined,
      seeds,
      trending: async () => [item(70), item(71)],
      hiddenTags: () => ["Ecchi"],
      now: () => now,
    });
    try {
      const feed = await service.getForYou("ANIME");
      const all = [...feed.items, ...(feed.rows ?? []).flatMap((row) => row.items)].map(
        (row) => row.anilistId,
      );
      expect(all).not.toContain(50);
      const next = [
        ...feed.items,
        ...(feed.rows?.find((row) => row.continuation)?.items ?? []),
      ].map((row) => row.anilistId);
      expect(next).toEqual(expect.arrayContaining([101, 102, 103]));
    } finally {
      db.close();
    }
  });
});
