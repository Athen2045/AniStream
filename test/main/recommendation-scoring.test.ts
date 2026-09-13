import { describe, expect, it } from "vitest";
import { buildRecommendationProfile } from "../../src/main/recommendations/profile";
import {
  filterRecommendationCandidates,
  scoreRecommendationCandidate,
  selectRecommendations,
} from "../../src/main/recommendations/scoring";
import type {
  RecommendationCandidate,
  RecommendationEvent,
  RecommendationItemFeatures,
} from "../../src/shared/recommendations";

const now = Date.parse("2026-08-11T00:00:00.000Z");

function item(
  id: number,
  title: string,
  tags: string[],
  type: "ANIME" | "MANGA" = "ANIME",
): RecommendationItemFeatures {
  return {
    anilistId: id,
    mediaType: type,
    normalizedTitle: title,
    titleTokens: title.toLocaleLowerCase().split(" "),
    synonyms: [],
    genres: ["Drama"],
    tags: tags.map((name, index) => ({ id: id * 10 + index, name, rank: 80 })),
    creators: [{ name: "Creator One", role: type === "ANIME" ? "STUDIO" : "AUTHOR" }],
    averageScore: 80,
    popularity: 10_000,
    updatedAt: now,
  };
}

const seed = item(1, "Psychological Drama", ["Psychological", "Thriller"]);
const profile = buildRecommendationProfile(
  [
    {
      anilistId: 1,
      mediaType: "ANIME",
      occurredAt: now,
      eventType: "explored",
      source: "detail",
    } satisfies RecommendationEvent,
  ],
  [seed],
  now,
);

describe("recommendation scoring", () => {
  it("preserves the 0–100 score scale instead of rounding every result below one", () => {
    const scored = scoreRecommendationCandidate({ features: seed }, profile, now);
    expect(scored.score).toBeCloseTo(scored.rawScore * 100, 2);
    expect(scored.score).toBeGreaterThan(1);
  });

  it("does not recommend a negatively weighted creator as someone the viewer likes", () => {
    const negative = buildRecommendationProfile(
      [
        {
          anilistId: 1,
          mediaType: "ANIME",
          occurredAt: now,
          eventType: "dismissed",
          source: "detail",
        },
      ],
      [seed],
      now,
    );
    const scored = scoreRecommendationCandidate(
      { features: item(2, "Another story", []) },
      negative,
      now,
    );
    expect(scored.reasonCodes).not.toContain("same-creator");
  });
  it("ranks a matching tag above an unrelated candidate", () => {
    const match: RecommendationCandidate = { features: item(2, "Mind Game", ["Psychological"]) };
    const other: RecommendationCandidate = { features: item(3, "Bright Romance", ["Romance"]) };

    expect(scoreRecommendationCandidate(match, profile, now).score).toBeGreaterThan(
      scoreRecommendationCandidate(other, profile, now).score,
    );
  });

  it("filters completed, current, dismissed, and duplicate candidates", () => {
    const candidates: RecommendationCandidate[] = [
      { features: item(2, "A", ["Psychological"]) },
      { features: item(2, "A duplicate", ["Psychological"]) },
      { features: item(3, "Completed", ["Psychological"]), completed: true },
      { features: item(4, "Current", ["Psychological"]), current: true },
      { features: item(5, "Dismissed", ["Psychological"]), dismissed: true },
    ];

    expect(
      filterRecommendationCandidates(candidates, new Set([99])).map(
        (candidate) => candidate.features.anilistId,
      ),
    ).toEqual([2]);
  });

  it("selects a deterministic diverse list with reason codes", () => {
    const scored = [2, 3, 4, 5, 6].map((id) =>
      scoreRecommendationCandidate(
        { features: item(id, `Title ${id}`, [id === 2 ? "Psychological" : "Romance"]) },
        profile,
        now,
      ),
    );

    const selected = selectRecommendations(scored, 3);
    expect(selected).toHaveLength(3);
    expect(selected[0].reasonCodes).toContain("matches-tag");
    expect(selected.every((result) => result.score >= 0 && result.score <= 100)).toBe(true);
  });
});
