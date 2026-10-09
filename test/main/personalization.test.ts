import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import type { MoreHistoryEntry } from "../../src/main/more-library";
import {
  MoreDiscoveryService,
  moreAffinity,
} from "../../src/main/recommendations/more-discovery-service";
import { createPersonalizationStore } from "../../src/main/recommendations/personalization-store";
import {
  collaborativeEdges,
  createSimklCatalogStore,
  parseSimklTitle,
} from "../../src/main/simkl/collaborative";
import type { MoreRecommendationSeed } from "../../src/main/tmdb";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 7);
const day = 86_400_000;

function memory() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

describe("personalization store", () => {
  it("keeps title choices and drops measurements when activity learning is turned off", () => {
    const db = memory();
    try {
      const store = createPersonalizationStore(db);
      store.setFeedback({ type: "MOVIE", id: 5 }, "interested", now);
      store.setFeedback({ type: "ANIME", id: 7 }, "not-interested", now);
      expect(store.getFeedback({ type: "MOVIE", id: 5 })).toBe("interested");
      store.setFeedback({ type: "MOVIE", id: 5 }, null, now);
      expect(store.getFeedback({ type: "MOVIE", id: 5 })).toBeNull();
      expect(store.feedback()).toEqual([
        { type: "ANIME", id: 7, value: "not-interested", updatedAt: now },
      ]);

      expect(store.activitySignals()).toBe(true);
      for (const seconds of [10, 50, 30]) store.recordTimeToPlay("MORE", seconds, now);
      expect(store.timeToPlay()).toEqual([{ section: "MORE", medianSeconds: 30, samples: 3 }]);
      store.setActivitySignals(false);
      expect(store.activitySignals()).toBe(false);
      expect(store.timeToPlay()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("Netflix-style playback signals", () => {
  const entry = (patch: Partial<MoreHistoryEntry>): MoreHistoryEntry => ({
    type: "MOVIE",
    tmdbId: 1,
    watchlisted: false,
    maxRatio: 0,
    finishedEpisodes: 0,
    updatedAt: new Date(now).toISOString(),
    ...patch,
  });

  it("reads two minutes as intent and an old half-watched movie as abandoned", () => {
    expect(moreAffinity(entry({ maxRatio: 0.02, maxPositionSeconds: 60 }), 7, { now })).toBe(0);
    expect(moreAffinity(entry({ maxRatio: 0.03, maxPositionSeconds: 150 }), 7, { now })).toBe(0.15);
    const stale = new Date(now - 20 * day).toISOString();
    expect(moreAffinity(entry({ maxRatio: 0.4, updatedAt: stale }), 7, { now })).toBe(-0.3);
    // Still being watched, or learning switched off: no abandonment.
    expect(moreAffinity(entry({ maxRatio: 0.4 }), 7, { now })).toBe(0.35);
    expect(
      moreAffinity(entry({ maxRatio: 0.4, updatedAt: stale }), 7, { now, activity: false }),
    ).toBe(0.35);
    expect(moreAffinity(entry({ maxPositionSeconds: 300 }), 7, { now, activity: false })).toBe(0);
  });

  it("applies title-page choices over watching behaviour", () => {
    expect(moreAffinity(entry({ feedback: 1 }), 7, { now })).toBe(0.5);
    expect(moreAffinity(entry({ feedback: 1, finishedEpisodes: 1 }), 7, { now })).toBe(0.6);
    expect(moreAffinity(entry({ feedback: -1, finishedEpisodes: 1 }), 7, { now })).toBe(-1);
  });
});

describe("Simkl collaborative recommendations", () => {
  it("parses a title page and resolves co-watched neighbours from cache", () => {
    const db = memory();
    try {
      const store = createSimklCatalogStore(db);
      const seed = parseSimklTitle(
        {
          title: "Inception",
          ids: { simkl: 1, tmdb: "27205" },
          language: "EN",
          genres: ["Science Fiction"],
          ratings: { simkl: { rating: 8.6, votes: 11454 } },
          users_recommendations: [
            { title: "Interstellar", type: "movie", ids: { simkl: 2 } },
            { title: "Show", type: "tv", ids: { simkl: 3 } },
            { title: "Anime", type: "anime", ids: { simkl: 4 } },
          ],
        },
        "MOVIE",
        1,
        now,
      );
      expect(seed.features).toMatchObject({
        anilistId: 27205,
        genres: ["Sci-Fi"],
        origin: "en",
        averageScore: 86,
      });
      expect(seed.recommendations).toEqual([
        { type: "MOVIE", simklId: 2 },
        { type: "TV", simklId: 3 },
      ]);
      store.save(seed, now);
      expect(collaborativeEdges(store, { type: "MOVIE", simklId: 1 })?.edges).toEqual([]);
      store.save(
        parseSimklTitle(
          { title: "Interstellar", ids: { simkl: 2, tmdb: "157336" } },
          "MOVIE",
          2,
          now,
        ),
        now,
      );
      store.save(parseSimklTitle({ title: "No TMDB", ids: { simkl: 3 } }, "TV", 3, now), now);
      expect(collaborativeEdges(store, { type: "MOVIE", simklId: 1 })).toMatchObject({
        edges: [{ id: 157336, mediaType: "MOVIE", rating: 20 }],
        features: [{ anilistId: 157336, normalizedTitle: "Interstellar" }],
      });
      expect(collaborativeEdges(store, { type: "MOVIE", simklId: 99 })).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe("More For You with title choices and collaborative edges", () => {
  const title = (id: number, overrides: Partial<RecommendationItemFeatures> = {}) =>
    ({
      anilistId: id,
      mediaType: "MOVIE",
      normalizedTitle: `MOVIE ${id}`,
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
    }) as RecommendationItemFeatures;

  it("seeds from Interested titles, hides Not interested ones, and ranks co-watched picks", async () => {
    const db = openAppDatabase(":memory:");
    try {
      db.personalization.setFeedback({ type: "MOVIE", id: 1 }, "interested", now);
      db.personalization.setFeedback({ type: "MOVIE", id: 2 }, "interested", now);
      db.personalization.setFeedback({ type: "MOVIE", id: 300 }, "not-interested", now);
      const seed = vi.fn(async (id: number): Promise<MoreRecommendationSeed> => ({
        seed: { ...title(id), recommendations: [] },
        neighbors: [],
      }));
      const service = new MoreDiscoveryService({
        store: db.moreDiscovery,
        history: () => [],
        aniListTaste: () => [],
        seed,
        trending: async () => [title(300), title(301)],
        feedback: () => db.personalization.feedback(),
        collaborative: (ref) =>
          ref.tmdbId === 1
            ? {
                edges: [{ id: 400, mediaType: "MOVIE", rating: 20 }],
                features: [title(400, { averageScore: 60, popularity: 10 })],
              }
            : undefined,
        now: () => now,
      });
      const feed = await service.getForYou();
      expect(feed.basis).toBe("more");
      expect(seed.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
      const ids = feed.items.map((row) => row.item.id);
      expect(ids).not.toContain(300);
      expect(ids).not.toContain(1);
      // The co-watched title outranks a stronger-looking trending title on the graph signal.
      expect(ids.indexOf(400)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(400)).toBeLessThan(ids.indexOf(301));
    } finally {
      db.close();
    }
  });
});

describe("More hero unlock count", () => {
  it("counts only movies and shows actually watched", async () => {
    const { moreWatchedTitles } =
      await import("../../src/main/recommendations/more-discovery-service");
    const base = {
      type: "MOVIE" as const,
      watchlisted: false,
      maxRatio: 0,
      finishedEpisodes: 0,
      updatedAt: new Date(now).toISOString(),
    };
    expect(
      moreWatchedTitles([
        { ...base, tmdbId: 1, maxRatio: 0.3 },
        { ...base, tmdbId: 2, watchlisted: true },
        { ...base, tmdbId: 3, maxRatio: 0.1 },
        { ...base, type: "TV", tmdbId: 4, finishedEpisodes: 2 },
        { ...base, tmdbId: 5, trackerStatus: "completed" },
      ]),
    ).toBe(3);
  });
});
