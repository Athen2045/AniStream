import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";
import type {
  RecommendationEvent,
  RecommendationItemFeatures,
} from "../../src/shared/recommendations";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const features: RecommendationItemFeatures = {
  anilistId: 44,
  mediaType: "MANGA",
  malId: 88,
  normalizedTitle: "Local Story",
  coverUrl: "https://example.test/cover.jpg",
  titleTokens: ["local", "story"],
  synonyms: [],
  genres: ["Drama"],
  tags: [{ id: 1, name: "Drama" }],
  creators: [{ name: "Writer", role: "AUTHOR" }],
  updatedAt: 100,
};

describe("recommendation persistence", () => {
  it("persists events and normalized feature snapshots across database reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "anistream-recommendations-"));
    directories.push(directory);
    const path = join(directory, "anistream.sqlite");
    const event: RecommendationEvent = {
      anilistId: 44,
      mediaType: "MANGA",
      occurredAt: 100,
      eventType: "explored",
      source: "detail",
    };
    const first = openAppDatabase(path);
    first.recordRecommendationEvent(event);
    first.upsertRecommendationItemFeatures(features);
    first.close();

    const second = openAppDatabase(path);
    expect(second.listRecommendationEvents()).toEqual([event]);
    expect(second.listRecommendationItemFeatures()).toEqual([features]);
    second.close();
  });

  it("stores recommendation impressions in bounded serializable form", () => {
    const directory = mkdtempSync(join(tmpdir(), "anistream-recommendations-"));
    directories.push(directory);
    const database = openAppDatabase(join(directory, "anistream.sqlite"));
    database.recordRecommendationImpressions("request-1", [
      {
        anilistId: 44,
        mediaType: "MANGA",
        title: "Local Story",
        score: 70,
        reasonCodes: ["matches-tag"],
      },
    ]);
    expect(database.listRecommendationImpressions("request-1")).toMatchObject([
      { requestId: "request-1", anilistId: 44, position: 0, score: 70 },
    ]);
    database.close();
  });
});
