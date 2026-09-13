import { describe, expect, it, vi } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import { DiscoveryService } from "../../src/main/recommendations/discovery-service";
import { discoveryEvidence } from "../../src/main/recommendations/discovery-evidence";
import { loadRecommendationSeeds } from "../../src/main/anilist/recommendation-seeds";
import type { AniListMedia, AniListMediaType } from "../../src/shared/contracts";

const now = Date.now();
const media = (id: number, type: AniListMediaType = "ANIME"): AniListMedia => ({
  id,
  type,
  title: `Title ${id}`,
  coverUrl: "https://example.test/cover.jpg",
  genres: ["Drama"],
  siteUrl: `https://anilist.co/anime/${id}`,
  averageScore: 80,
});
function setup() {
  const db = openAppDatabase(":memory:");
  for (let id = 1; id <= 5; id++)
    db.recordActivity({ media: media(id), unit: 1, state: "completed" });
  let owner = 0;
  const seeds = vi.fn(async (ids: number[]) => ids.map((id) => media(id)));
  const browse = vi.fn(async () => ({
    items: [media(1), media(10), media(11)].map((row) => ({ ...row, genres: row.genres ?? [] })),
    pageInfo: { currentPage: 1, perPage: 30, lastPage: 1, hasNextPage: false },
  }));
  const impression = vi.spyOn(db.discovery, "impression");
  const service = new DiscoveryService({
    store: db.discovery,
    activity: () => db.listActivity(owner),
    owner: () => owner,
    dashboard: () => undefined,
    seeds,
    browse,
    now: () => now,
  });
  return {
    db,
    service,
    seeds,
    browse,
    impression,
    setOwner: (value: number) => {
      owner = value;
    },
  };
}

describe("live local discovery", () => {
  it("rejects a pending result after the viewer changes without writing its features", async () => {
    const { db, service, seeds, browse, setOwner } = setup();
    const write = vi.spyOn(db.discovery, "saveFeatures");
    let finish: (items: AniListMedia[]) => void = () => undefined;
    seeds.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    try {
      const pending = service.getForYou("ANIME");
      setOwner(42);
      finish([media(1)]);
      await expect(pending).rejects.toThrow(/Viewer changed/);
      expect(write).not.toHaveBeenCalled();
      expect(browse).not.toHaveBeenCalled();
    } finally {
      service.dispose();
      db.close();
    }
  });
  it("uses real evidence, bounds/caches reads, excludes consumed titles and records only visible impressions", async () => {
    const { db, service, seeds, browse, impression } = setup();
    try {
      db.recordRecommendationEvent({
        anilistId: 999,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "dismissed",
        source: "detail",
      });
      expect(db.discovery.events(0)).toEqual([]);
      const feed = await service.getForYou("ANIME");
      expect(feed.items.map((row) => row.anilistId)).toEqual([10, 11]);
      expect(seeds).toHaveBeenCalledTimes(1);
      expect(browse).toHaveBeenCalledTimes(2);
      expect(browse.mock.calls[0][0]).toMatchObject({ page: 1, perPage: 20, type: "ANIME" });
      expect(impression).not.toHaveBeenCalled();
      service.impressions({ requestId: feed.requestId!, anilistIds: [10] });
      expect(impression).toHaveBeenCalledOnce();
      expect(() =>
        service.impressions({ requestId: feed.requestId!, anilistIds: [999] }),
      ).toThrow();
      await service.getForYou("ANIME");
      expect(browse).toHaveBeenCalledTimes(2);
      expect(seeds).toHaveBeenCalledTimes(1);
    } finally {
      service.dispose();
      db.close();
    }
  });
  it("persists dismissals per viewer, supports undo and rejects cross-viewer request identities", async () => {
    const { db, service, setOwner } = setup();
    try {
      const feed = await service.getForYou("ANIME");
      service.feedback({ requestId: feed.requestId!, anilistId: 10, action: "dismiss" });
      expect((await service.getForYou("ANIME")).items.map((row) => row.anilistId)).toEqual([11]);
      expect(db.discovery.events(0).some((row) => row.eventType === "dismissed")).toBe(true);
      service.feedback({ requestId: feed.requestId!, anilistId: 10, action: "undo" });
      expect((await service.getForYou("ANIME")).items).toHaveLength(2);
      setOwner(42);
      expect(db.discovery.events(42)).toEqual([]);
      expect(() =>
        service.feedback({ requestId: feed.requestId!, anilistId: 10, action: "dismiss" }),
      ).toThrow(/Viewer changed/);
    } finally {
      service.dispose();
      db.close();
    }
  });
  it("never unlocks from preview events or recommendation clicks alone", async () => {
    const db = openAppDatabase(":memory:");
    const browse = vi.fn();
    const service = new DiscoveryService({
      store: db.discovery,
      activity: () => [],
      owner: () => 0,
      dashboard: () => undefined,
      seeds: vi.fn(),
      browse,
    });
    try {
      for (let id = 1; id <= 5; id++)
        db.discovery.feedback(
          0,
          { anilistId: id, mediaType: "ANIME", title: "Preview", score: 50, reasonCodes: [] },
          "explore",
          now,
        );
      expect((await service.getForYou("ANIME")).status).toBe("learning");
      expect(browse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
  it("stops new candidate requests after seed or candidate failure and returns a truthful unavailable state", async () => {
    const { db, service, seeds, browse } = setup();
    try {
      seeds.mockRejectedValueOnce(new Error("429"));
      expect((await service.getForYou("ANIME")).status).toBe("unavailable");
      expect(browse).not.toHaveBeenCalled();
      browse.mockRejectedValueOnce(new Error("timeout"));
      expect((await service.getForYou("ANIME")).status).toBe("unavailable");
      expect(browse).toHaveBeenCalledOnce();
    } finally {
      service.dispose();
      db.close();
    }
  });
  it("ends a recommendation refresh when provider work is stuck behind a queue", async () => {
    vi.useFakeTimers();
    const { db, service, browse } = setup();
    browse.mockImplementationOnce(
      (_input, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    try {
      const pending = service.getForYou("ANIME");
      await vi.advanceTimersByTimeAsync(15_001);
      const result = await pending;
      expect(result.status).toBe("unavailable");
      expect(result.message).toMatch(/taking longer|try again/i);
    } finally {
      service.dispose();
      db.close();
      vi.useRealTimers();
    }
  });
  it("keeps all library statuses excluded and deduplicates custom list evidence", () => {
    const row = {
      id: 100,
      media: media(1),
      status: "CURRENT" as const,
      progress: 2,
      score: 8,
      repeat: 0,
      updatedAt: now / 1000,
    };
    const evidence = discoveryEvidence([], {
      profile: { id: 5 } as never,
      fetchedAt: new Date(now).toISOString(),
      animeLists: [
        { name: "Watching", isCustomList: false, entries: [row] },
        { name: "Custom", isCustomList: true, entries: [row] },
      ],
      mangaLists: [],
    });
    expect(evidence.events).toHaveLength(2);
    expect(evidence.excluded.has(1)).toBe(true);
  });
});

describe("AniList recommendation seed edge", () => {
  it("bounds exact-ID requests and rejects unrelated response identities", async () => {
    const request = vi.fn(async () => ({ Page: { media: [{ id: 999, type: "ANIME" }] } }));
    expect(
      await loadRecommendationSeeds(
        request,
        Array.from({ length: 80 }, (_, index) => index + 1),
      ),
    ).toEqual([]);
    expect(request.mock.calls[0][1].ids).toHaveLength(24);
  });
  it("does no work for empty IDs and reports malformed and provider failures", async () => {
    const request = vi.fn(async () => ({}));
    expect(await loadRecommendationSeeds(request, [])).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    await expect(loadRecommendationSeeds(request, [1])).rejects.toThrow(/invalid/);
    request.mockRejectedValueOnce(new Error("429"));
    await expect(loadRecommendationSeeds(request, [1])).rejects.toThrow("429");
  });
});
