import { describe, expect, it } from "vitest";
import {
  type RecommendationEvent,
  type RecommendationItemFeatures,
  type RecommendationResult,
} from "../../src/shared/recommendations";

describe("recommendation contracts", () => {
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
      mediaType: "MANGA",
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
