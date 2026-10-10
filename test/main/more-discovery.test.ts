import { describe, expect, it, vi } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import type { MoreHistoryEntry } from "../../src/main/more-library";
import type { HybridHistoryItem } from "../../src/main/recommendations/engine";
import {
  MoreDiscoveryService,
  moreAffinity,
} from "../../src/main/recommendations/more-discovery-service";
import { TmdbClient, type MoreRecommendationSeed } from "../../src/main/tmdb";
import type { MoreMediaType } from "../../src/shared/contracts";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 4);

function title(
  id: number,
  type: MoreMediaType = "MOVIE",
  overrides: Partial<RecommendationItemFeatures> = {},
): RecommendationItemFeatures {
  return {
    anilistId: id,
    mediaType: type,
    normalizedTitle: `${type} ${id}`,
    coverUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
    releaseDate: "2020-01-01",
    titleTokens: [],
    synonyms: [],
    genres: ["Drama"],
    tags: [],
    creators: [],
    averageScore: 75,
    popularity: 5_000,
    origin: "en",
    updatedAt: now,
    ...overrides,
  };
}

function watched(
  id: number,
  patch: Partial<MoreHistoryEntry> = {},
  type: MoreMediaType = "MOVIE",
): MoreHistoryEntry {
  return {
    type,
    tmdbId: id,
    title: `${type} ${id}`,
    watchlisted: false,
    maxRatio: 1,
    finishedEpisodes: 1,
    updatedAt: new Date(now).toISOString(),
    ...patch,
  };
}

function setup(history: MoreHistoryEntry[], aniListTaste: HybridHistoryItem[] = []) {
  const db = openAppDatabase(":memory:");
  // Every seed recommends movies 100–107 and its own library sibling 1 (excluded as watched).
  const seed = vi.fn(async (id: number, type: MoreMediaType): Promise<MoreRecommendationSeed> => ({
    seed: {
      ...title(id, type),
      // TMDB records "no film series" as 0, so the seed is not refetched to ask again.
      ...(type === "MOVIE" ? { collectionId: 0 } : {}),
      recommendations: [1, ...Array.from({ length: 8 }, (_, index) => 100 + index)].map(
        (target, index) => ({ id: target, mediaType: "MOVIE" as const, rating: 15 - index }),
      ),
    },
    neighbors: Array.from({ length: 8 }, (_, index) => title(100 + index)),
  }));
  const trending = vi.fn(async (type: MoreMediaType) =>
    type === "MOVIE" ? [title(200), title(1)] : [title(300, "TV", { genres: ["Sci-Fi"] })],
  );
  const service = new MoreDiscoveryService({
    store: db.moreDiscovery,
    history: () => history,
    aniListTaste: () => aniListTaste,
    seed,
    trending,
    now: () => now,
  });
  return { db, service, seed, trending };
}

describe("More For You", () => {
  it("counts real watching, not player checks, as taste evidence", () => {
    expect(moreAffinity(watched(1, { maxRatio: 0.14, finishedEpisodes: 0 }))).toBe(0);
    expect(moreAffinity(watched(1, { maxRatio: 0.3, finishedEpisodes: 0 }))).toBe(0.35);
    expect(moreAffinity(watched(1))).toBe(0.6);
    expect(moreAffinity(watched(1, { finishedEpisodes: 1 }, "TV"))).toBe(0.35);
    expect(moreAffinity(watched(1, { finishedEpisodes: 2 }, "TV"))).toBe(0.6);
    expect(moreAffinity(watched(1, { maxRatio: 0, finishedEpisodes: 0, watchlisted: true }))).toBe(
      0.25,
    );
  });

  it("stays in learning without More evidence or AniList taste, and makes no requests", async () => {
    const { db, service, seed, trending } = setup([
      watched(1, { maxRatio: 0.1, finishedEpisodes: 0 }),
    ]);
    try {
      expect(await service.getForYou()).toMatchObject({ status: "learning", items: [] });
      expect(seed).not.toHaveBeenCalled();
      expect(trending).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("cold-starts from AniList taste over trending titles and says so", async () => {
    const anime: HybridHistoryItem = {
      features: { ...title(9), mediaType: "ANIME", genres: ["Sci-Fi"] },
      affinity: 1,
      occurredAt: now,
    };
    const { db, service, seed } = setup([], [anime]);
    try {
      const feed = await service.getForYou();
      expect(feed.basis).toBe("anime-taste");
      expect(feed.message).toMatch(/anime and manga taste/i);
      expect(seed).not.toHaveBeenCalled();
      // The Sci-Fi show matches the anime prior; no "Because you watched" without More seeds.
      expect(feed.items[0].item).toMatchObject({ id: 300, type: "TV" });
      expect(feed.items.every((row) => row.relatedTitle === undefined)).toBe(true);
      expect(feed.rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("ranks TMDB neighbors of watched titles, excludes watched/dismissed, and caches seeds", async () => {
    const { db, service, seed, trending } = setup([watched(1), watched(2)]);
    try {
      const feed = await service.getForYou();
      expect(feed.basis).toBe("more");
      expect(seed).toHaveBeenCalledTimes(2);
      const ids = feed.items.map((row) => row.item.id);
      expect(ids).not.toContain(1);
      // Neighbours lead; repeats of one seed fade, so an unrelated title may join early.
      expect(ids.slice(0, 2).every((id) => id >= 100 && id < 108)).toBe(true);
      expect(ids.filter((id) => id >= 100 && id < 108).length).toBeGreaterThanOrEqual(6);
      expect(feed.items[0].relatedTitle).toMatch(/^MOVIE [12]$/);

      service.feedback({
        requestId: feed.requestId!,
        type: "MOVIE",
        tmdbId: ids[0],
        action: "dismiss",
      });
      const next = await service.getForYou();
      expect(next.items.map((row) => row.item.id)).not.toContain(ids[0]);
      expect(seed).toHaveBeenCalledTimes(2); // seeds cached for 7 days
      expect(trending).toHaveBeenCalledTimes(2); // movies + shows, cached for 10 minutes
      expect(() =>
        service.feedback({ requestId: "unknown", type: "MOVIE", tmdbId: 1, action: "undo" }),
      ).toThrow(/expired/);
    } finally {
      db.close();
    }
  });

  it("personalizes from imported tracker titles and never seeds from dropped ones", async () => {
    const tracker = (id: number, patch: Partial<MoreHistoryEntry>) =>
      watched(id, { maxRatio: 0, finishedEpisodes: 0, ...patch });
    const { db, service, seed } = setup([
      tracker(1, { trackerStatus: "completed", rating: 9 }),
      tracker(2, { trackerStatus: "completed", rating: 8 }),
      tracker(3, { trackerStatus: "dropped" }),
    ]);
    try {
      const feed = await service.getForYou();
      expect(feed.basis).toBe("more");
      expect(seed.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
      expect(feed.items.map((row) => row.item.id)).not.toContain(3);
    } finally {
      db.close();
    }
  });

  it("adds same-language candidates for non-English history and keeps their rows in it", async () => {
    const db = openAppDatabase(":memory:");
    try {
      const malayalam = (id: number) => title(id, "MOVIE", { origin: "ml" });
      const seed = vi.fn(async (id: number): Promise<MoreRecommendationSeed> => ({
        seed: {
          ...malayalam(id),
          // TMDB's own neighbours of a Malayalam film are mostly English here.
          recommendations: [500, 501, 502].map((target, index) => ({
            id: target,
            mediaType: "MOVIE" as const,
            rating: 10 - index,
          })),
        },
        neighbors: [500, 501, 502].map((id) => title(id, "MOVIE", { origin: "en" })),
      }));
      const byLanguage = vi.fn(async (_type: MoreMediaType, language: string) =>
        language === "ml" ? Array.from({ length: 30 }, (_, index) => malayalam(600 + index)) : [],
      );
      const service = new MoreDiscoveryService({
        store: db.moreDiscovery,
        history: () => [watched(1), watched(2)],
        aniListTaste: () => [],
        seed,
        trending: async () => [title(200, "MOVIE", { origin: "en" })],
        byLanguage,
        now: () => now,
      });
      const feed = await service.getForYou();
      expect(byLanguage).toHaveBeenCalledWith("MOVIE", "ml");
      expect(feed.rows?.length).toBeGreaterThan(0);
      for (const row of feed.rows ?? [])
        if (!row.theme)
          expect(row.items.every((entry) => entry.item.id >= 600 && entry.item.id < 630)).toBe(
            true,
          );
    } finally {
      db.close();
    }
  });

  it("fills a theme row from TMDB titles carrying a keyword shared by liked titles", async () => {
    const db = openAppDatabase(":memory:");
    try {
      const loop = { id: 42, name: "time loop", rank: 70 };
      const seed = vi.fn(async (id: number): Promise<MoreRecommendationSeed> => ({
        seed: { ...title(id, "MOVIE", { tags: [loop] }), recommendations: [] },
        neighbors: [],
      }));
      const byKeyword = vi.fn(async () =>
        Array.from({ length: 30 }, (_, index) => title(700 + index, "MOVIE", { tags: [loop] })),
      );
      const service = new MoreDiscoveryService({
        store: db.moreDiscovery,
        history: () => [watched(1), watched(2)],
        aniListTaste: () => [],
        seed,
        trending: async () => [],
        byKeyword,
        now: () => now,
      });
      const feed = await service.getForYou();
      expect(byKeyword).toHaveBeenCalledWith("MOVIE", { id: 42, name: "time loop" });
      const row = feed.rows?.find((entry) => entry.theme);
      expect(row?.theme).toBe("Time Loop");
      expect(row?.items.length).toBeGreaterThanOrEqual(6);
    } finally {
      db.close();
    }
  });

  it("stops at the first TMDB failure and keeps cached results honest", async () => {
    const { db, service, seed, trending } = setup([watched(1), watched(2), watched(3)]);
    seed.mockRejectedValueOnce(new Error("TMDB temporarily refused requests (429)."));
    try {
      const feed = await service.getForYou();
      expect(seed).toHaveBeenCalledOnce();
      expect(trending).not.toHaveBeenCalled();
      expect(feed.message).toMatch(/busy/i);
    } finally {
      db.close();
    }
  });
});

describe("More cross-section identity", () => {
  it("hides TMDB titles exactly linked to anime the viewer started", async () => {
    const db = openAppDatabase(":memory:");
    const anime: HybridHistoryItem = {
      features: { ...title(9), mediaType: "ANIME", genres: ["Sci-Fi"] },
      affinity: 1,
      occurredAt: now,
    };
    const service = new MoreDiscoveryService({
      store: db.moreDiscovery,
      history: () => [],
      aniListTaste: () => [anime],
      seed: vi.fn(),
      trending: async (type) =>
        type === "TV" ? [title(300, "TV", { genres: ["Sci-Fi"] })] : [title(200)],
      links: () => ({
        tmdbKeysFor: () => [],
        aniListIdsFor: (type, id) => (type === "TV" && id === 300 ? [9] : []),
      }),
      watchedAniList: () => new Set([9]),
      now: () => now,
    });
    try {
      const ids = (await service.getForYou()).items.map((row) => `${row.item.type}:${row.item.id}`);
      expect(ids).toEqual(["MOVIE:200"]);
    } finally {
      db.close();
    }
  });
});

describe("TMDB recommendation adapter", () => {
  it("parses keywords, directors, lead cast, shared genres and rank-weighted edges", async () => {
    const requested: string[] = [];
    const client = new TmdbClient("test-token", async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname + url.search);
      const body = url.pathname.endsWith("/genre/movie/list")
        ? { genres: [{ id: 878, name: "Science Fiction" }] }
        : {
            id: 27205,
            title: "Inception",
            release_date: "2010-07-16",
            vote_average: 8.4,
            vote_count: 30_000,
            genres: [{ id: 878, name: "Science Fiction" }],
            keywords: { keywords: [{ id: 1, name: "dream" }] },
            credits: {
              crew: [
                { id: 7, name: "Director Person", job: "Director" },
                { id: 8, name: "Editor", job: "Editor" },
              ],
              cast: [{ id: 9, name: "Lead" }],
            },
            recommendations: {
              results: [
                { id: 155, title: "Next", genre_ids: [878], vote_average: 8, vote_count: 10 },
                { id: 27205, title: "Self", genre_ids: [] },
                { id: "bad" },
              ],
            },
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { seed, neighbors } = await client.getRecommendationSeed(27205, "MOVIE");
    expect(
      requested.some((path) =>
        path.includes("append_to_response=keywords%2Ccredits%2Crecommendations"),
      ),
    ).toBe(true);
    expect(seed).toMatchObject({
      anilistId: 27205,
      mediaType: "MOVIE",
      genres: ["Sci-Fi"],
      averageScore: 84,
      popularity: 30_000,
      tags: [{ id: 1, name: "dream", rank: 70 }],
      creators: [
        { id: 7, name: "Director Person", role: "PERSON" },
        { id: 9, name: "Lead", role: "PERSON" },
      ],
      recommendations: [{ id: 155, mediaType: "MOVIE", rating: 15 }],
    });
    expect(neighbors).toEqual([expect.objectContaining({ anilistId: 155, genres: ["Sci-Fi"] })]);
  });
});

describe("next film in a series the viewer liked", () => {
  it("adds the next released film of a liked film's collection as its own row", async () => {
    const db = openAppDatabase(":memory:");
    try {
      // Watched: film 1 and film 2, both part 1 of collections 70 and 80.
      const seed = vi.fn(
        async (id: number, type: MoreMediaType): Promise<MoreRecommendationSeed> => ({
          seed: {
            ...title(id, type),
            collectionId: id === 1 ? 70 : 80,
            releaseDate: "2010-01-01",
            recommendations: [500, 501].map((target) => ({
              id: target,
              mediaType: "MOVIE" as const,
              rating: 10,
            })),
          },
          neighbors: [title(500), title(501)],
        }),
      );
      const part = (id: number, date: string, collectionId: number) =>
        title(id, "MOVIE", { releaseDate: date, collectionId });
      const collection = vi.fn(async (id: number) =>
        id === 70
          ? [part(1, "2010-01-01", 70), part(11, "2013-01-01", 70), part(12, "2016-01-01", 70)]
          : [part(2, "2010-01-01", 80), part(21, "2014-01-01", 80), part(22, "2999-01-01", 80)],
      );
      const service = new MoreDiscoveryService({
        store: db.moreDiscovery,
        history: () => [watched(1), watched(2)],
        aniListTaste: () => [],
        seed,
        trending: async () => [],
        collection,
        now: () => now,
      });
      const feed = await service.getForYou();
      const next = [
        ...feed.items,
        ...(feed.rows?.find((row) => row.continuation)?.items ?? []),
      ].map((entry) => entry.item.id);
      // The next film of each series; never a later one, an unreleased one, or one already seen.
      expect(next).toEqual(expect.arrayContaining([11, 21]));
      expect(next).not.toContain(12);
      expect(next).not.toContain(22);
      expect(collection).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });
});
