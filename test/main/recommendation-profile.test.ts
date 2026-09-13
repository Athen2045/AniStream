import { describe, expect, it } from "vitest";
import { buildRecommendationProfile } from "../../src/main/recommendations/profile";
import type {
  RecommendationEvent,
  RecommendationItemFeatures,
} from "../../src/shared/recommendations";

const now = Date.parse("2026-08-11T00:00:00.000Z");

const anime: RecommendationItemFeatures = {
  anilistId: 1,
  mediaType: "ANIME",
  normalizedTitle: "Psycho Academy",
  titleTokens: ["psycho", "academy"],
  synonyms: ["Mind School"],
  genres: ["Drama"],
  tags: [{ id: 10, name: "Psychological", rank: 90 }],
  creators: [
    { id: 100, name: "Studio North", role: "STUDIO" },
    { id: 101, name: "A. Author", role: "STAFF" },
  ],
  averageScore: 85,
  updatedAt: now,
};

describe("buildRecommendationProfile", () => {
  it("turns exploration into positive tag, genre, creator, title, and format evidence", () => {
    const events: RecommendationEvent[] = [
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "explored",
        source: "detail",
      },
    ];

    const profile = buildRecommendationProfile(events, [anime], now);

    expect(profile.features["tag:psychological"].positiveWeight).toBeGreaterThan(0);
    expect(profile.features["genre:drama"].positiveWeight).toBeGreaterThan(0);
    expect(profile.features["creator:studio-north"].positiveWeight).toBeGreaterThan(0);
    expect(profile.features["title-token:psycho"].positiveWeight).toBeGreaterThan(0);
    expect(profile.features["format:anime"].positiveWeight).toBeGreaterThan(0);
    expect(profile.preferredMediaMix.anime).toBe(1);
  });

  it("decays old evidence and records negative behavior separately", () => {
    const events: RecommendationEvent[] = [
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now - 120 * 86_400_000,
        eventType: "explored",
        source: "detail",
      },
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "dismissed",
        source: "detail",
      },
    ];

    const profile = buildRecommendationProfile(events, [anime], now);
    const psychological = profile.features["tag:psychological"];

    expect(psychological.negativeWeight).toBeGreaterThan(psychological.positiveWeight);
    expect(psychological.evidenceCount).toBe(2);
  });

  it("uses the explicit rating value to distinguish high and low ratings", () => {
    const events: RecommendationEvent[] = [
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "rated",
        source: "profile",
        value: 10,
      },
      {
        anilistId: 1,
        mediaType: "ANIME",
        occurredAt: now,
        eventType: "rated",
        source: "profile",
        value: 2,
      },
    ];

    const profile = buildRecommendationProfile(events, [anime], now);
    const genre = profile.features["genre:drama"];

    expect(genre.positiveWeight).toBeGreaterThan(0);
    expect(genre.negativeWeight).toBeGreaterThan(0);
  });
});
