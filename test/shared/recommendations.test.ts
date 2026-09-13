import { describe, expect, it } from "vitest";
import {
  EVENT_WEIGHTS,
  FEATURE_PROPAGATION_WEIGHTS,
  RANKING_WEIGHTS,
  type RecommendationEvent,
  type RecommendationItemFeatures,
  type RecommendationResult,
} from "../../src/shared/recommendations";

describe("recommendation contracts", () => {
  it("defines the approved behavioral weights", () => {
    expect(EVENT_WEIGHTS.explored).toBe(0.25);
    expect(EVENT_WEIGHTS.completed).toBe(1.25);
    expect(EVENT_WEIGHTS.ratedHigh).toBe(1.5);
    expect(EVENT_WEIGHTS.dismissed).toBe(-1.5);
  });

  it("keeps feature propagation and rank weights explicit", () => {
    expect(FEATURE_PROPAGATION_WEIGHTS.tag).toBe(1);
    expect(FEATURE_PROPAGATION_WEIGHTS.genre).toBe(0.7);
    expect(FEATURE_PROPAGATION_WEIGHTS.creator).toBe(0.85);
    expect(RANKING_WEIGHTS.preferenceMatch).toBe(0.42);
    expect(Object.values(RANKING_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(1);
  });

  it("uses serializable normalized recommendation shapes", () => {
    const event: RecommendationEvent = {
      mediaType: "ANIME",
      anilistId: 1,
      occurredAt: 1_754_000_000_000,
      eventType: "explored",
      source: "detail",
    };
    const item: RecommendationItemFeatures = {
      anilistId: 2,
      mediaType: "MANGA",
      normalizedTitle: "Example",
      titleTokens: ["example"],
      synonyms: [],
      genres: ["Drama"],
      tags: [{ id: 10, name: "Psychological", rank: 85 }],
      creators: [{ name: "Author", role: "AUTHOR" }],
      updatedAt: 1_754_000_000_000,
    };
    const result: RecommendationResult = {
      anilistId: item.anilistId,
      mediaType: item.mediaType,
      title: item.normalizedTitle,
      score: 72.5,
      reasonCodes: ["matches-tag"],
    };

    expect(JSON.parse(JSON.stringify({ event, item, result }))).toEqual({
      event,
      item,
      result,
    });
  });
});
