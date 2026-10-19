import { describe, expect, it } from "vitest";
import {
  pairRowHybrid,
  rankHybrid,
  rankTastePairs,
  type HybridHistoryItem,
} from "../../src/main/recommendations/engine";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 12);

function item(id: number, genres: string[], tags: string[] = []): RecommendationItemFeatures {
  return {
    anilistId: id,
    mediaType: "ANIME",
    normalizedTitle: `Title ${id}`,
    titleTokens: [],
    synonyms: [],
    genres,
    tags: tags.map((name, at) => ({ id: at + 1, name, rank: 90 })),
    creators: [],
    averageScore: 75,
    popularity: 50_000,
    updatedAt: now,
  };
}
const liked = (features: RecommendationItemFeatures): HybridHistoryItem => ({
  features,
  affinity: 1,
  occurredAt: now,
});

/** Romance + Comedy four times; Mecha always with Super Robot (a synonym pair) three times. */
const history = [
  ...[1, 2, 3, 4].map((id) => liked(item(id, ["Romance", "Comedy"]))),
  ...[5, 6, 7].map((id) => liked(item(id, ["Mecha"], ["Super Robot"]))),
  liked(item(8, ["Action"])),
  liked(item(9, ["Drama"])),
];
/** The catalogue: Mecha titles always carry Super Robot; Romance and Comedy also appear apart. */
const catalogue = [
  ...[20, 21, 22, 23].map((id) => item(id, ["Mecha"], ["Super Robot"])),
  item(30, ["Romance", "Action"]),
  item(31, ["Romance", "Drama"]),
  item(32, ["Comedy", "Drama"]),
  item(33, ["Comedy", "Action"]),
  item(34, ["Romance", "Fantasy"]),
  item(35, ["Comedy", "Sports"]),
  item(36, ["Romance", "Comedy"]),
  item(37, ["Horror"]),
];

describe("tag-pair row", () => {
  it("finds the favourite mix and skips pairs where one taste implies the other", () => {
    const pairs = rankTastePairs(history, "ANIME", now, catalogue);
    expect(pairs[0]).toMatchObject({ a: "comedy", b: "romance", titles: 4 });
    expect(pairs.some((pair) => pair.a === "mecha" || pair.b === "mecha")).toBe(false);
  });

  it("keeps one half of the pair and swaps the other for a new partner, using both halves", () => {
    const scored = rankHybrid({ section: "ANIME", history, candidates: catalogue, now });
    const row = pairRowHybrid(scored, history, "ANIME", new Set(), { now, minItems: 4 });
    expect(row?.pair.map((name) => name.toLowerCase()).sort()).toEqual(["comedy", "romance"]);
    const ids = row!.items.map((entry) => entry.pick.features.anilistId);
    // Never both halves (36), never neither (37).
    expect(ids).not.toContain(36);
    expect(ids).not.toContain(37);
    const kept = new Set(row!.items.map((entry) => entry.combo[0]));
    expect(kept).toEqual(new Set(["Romance", "Comedy"]));
    for (const entry of row!.items) expect(["Romance", "Comedy"]).not.toContain(entry.combo[1]);
  });

  it("shows nothing without a pair liked on at least three titles", () => {
    const thin = [liked(item(1, ["Romance", "Comedy"])), liked(item(2, ["Romance", "Comedy"]))];
    const scored = rankHybrid({ section: "ANIME", history: thin, candidates: catalogue, now });
    expect(pairRowHybrid(scored, thin, "ANIME", new Set(), { now })).toBeUndefined();
  });
});
