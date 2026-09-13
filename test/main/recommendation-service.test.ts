import { describe, expect, it } from "vitest";
import {
  countMeaningfulRecommendationTitles,
  RecommendationService,
} from "../../src/main/recommendations/service";
import type {
  RecommendationCandidate,
  RecommendationEvent,
  RecommendationItemFeatures,
} from "../../src/shared/recommendations";

const now = Date.parse("2026-08-11T00:00:00.000Z");
const item = (id: number, type: "ANIME" | "MANGA", tag: string): RecommendationItemFeatures => ({
  anilistId: id,
  mediaType: type,
  normalizedTitle: `Title ${id}`,
  titleTokens: [`title-${id}`],
  synonyms: [],
  genres: ["Drama"],
  tags: [{ id, name: tag }],
  creators: [{ name: "Creator", role: type === "ANIME" ? "STUDIO" : "AUTHOR" }],
  averageScore: 80,
  updatedAt: now,
});

describe("RecommendationService", () => {
  it("does not produce For You recommendations before five meaningful titles", async () => {
    const events: RecommendationEvent[] = Array.from({ length: 4 }, (_, index) => ({
      anilistId: index + 1,
      mediaType: "ANIME",
      occurredAt: now,
      eventType: "started",
      source: "player",
    }));
    expect(countMeaningfulRecommendationTitles(events)).toBe(4);

    let candidatesRequested = false;
    const service = new RecommendationService({
      repository: {
        listRecommendationEvents: () => events,
        listRecommendationItemFeatures: () => [],
        recordRecommendationEvent: () => undefined,
        upsertRecommendationItemFeatures: () => undefined,
        recordRecommendationImpressions: () => undefined,
        listRecommendationImpressions: () => [],
      },
      candidateSource: async () => {
        candidatesRequested = true;
        return [];
      },
      now: () => now,
    });

    expect(await service.getForYou()).toEqual([]);
    expect(candidatesRequested).toBe(false);
  });

  it("returns a mixed 10-item preview and records impressions", async () => {
    const events: RecommendationEvent[] = [
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "explored",
        source: "detail",
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        anilistId: index + 20,
        mediaType: "ANIME" as const,
        occurredAt: now,
        eventType: "started" as const,
        source: "player" as const,
      })),
    ];
    const features = [
      item(1, "ANIME", "Psychological"),
      ...Array.from({ length: 12 }, (_, index) =>
        item(index + 2, index % 2 ? "MANGA" : "ANIME", index % 3 ? "Psychological" : "Romance"),
      ),
    ];
    const impressions: unknown[] = [];
    const service = new RecommendationService({
      repository: {
        listRecommendationEvents: () => events,
        listRecommendationItemFeatures: () => features,
        recordRecommendationEvent: () => undefined,
        upsertRecommendationItemFeatures: () => undefined,
        recordRecommendationImpressions: (_requestId, results) => impressions.push(results),
        listRecommendationImpressions: () => [],
      },
      candidateSource: async () =>
        features.slice(1).map((candidate): RecommendationCandidate => ({ features: candidate })),
      now: () => now,
    });

    const results = await service.getForYou();
    expect(results).toHaveLength(10);
    expect(new Set(results.map((result) => result.mediaType))).toEqual(new Set(["ANIME", "MANGA"]));
    expect(impressions).toHaveLength(1);
  });

  it("records a valid interaction through the repository", async () => {
    let recorded: RecommendationEvent | undefined;
    const service = new RecommendationService({
      repository: {
        listRecommendationEvents: () => [],
        listRecommendationItemFeatures: () => [],
        recordRecommendationEvent: (event) => {
          recorded = event;
        },
        upsertRecommendationItemFeatures: () => undefined,
        recordRecommendationImpressions: () => undefined,
        listRecommendationImpressions: () => [],
      },
      candidateSource: async () => [],
      now: () => now,
    });
    const event: RecommendationEvent = {
      anilistId: 4,
      mediaType: "MANGA",
      occurredAt: now,
      eventType: "started",
      source: "reader",
    };

    await service.recordInteraction(event);
    expect(recorded).toEqual(event);
  });
});
