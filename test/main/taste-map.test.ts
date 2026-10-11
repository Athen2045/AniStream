import { describe, expect, it } from "vitest";
import { buildTasteMap, type HybridHistoryItem } from "../../src/main/recommendations/engine";
import { louvain, tasteMapFingerprint } from "../../src/main/recommendations/engine/taste-map";
import {
  ContentSpace,
  dot,
  packedDot,
  packVectors,
} from "../../src/main/recommendations/engine/content";
import type { RecommendationItemFeatures } from "../../src/shared/recommendations";

const now = Date.UTC(2026, 9, 10);
const day = 86_400_000;

function item(
  id: number,
  overrides: Partial<RecommendationItemFeatures> = {},
): RecommendationItemFeatures {
  return {
    anilistId: id,
    mediaType: "ANIME",
    normalizedTitle: `Title ${id}`,
    titleTokens: [],
    synonyms: [],
    genres: [],
    tags: [],
    creators: [],
    updatedAt: now,
    ...overrides,
  };
}
const liked = (
  features: RecommendationItemFeatures,
  affinity = 1,
  age = 10,
): HybridHistoryItem => ({ features, affinity, occurredAt: now - age * day });

const tag = (name: string, rank = 90) => ({ id: name.length, name, rank });
const mystery = (id: number) =>
  item(id, { genres: ["Mystery"], tags: [tag("Detective"), tag("Time Travel")] });
const sports = (id: number) =>
  item(id, { genres: ["Sports"], tags: [tag("Swimming"), tag("Teamwork")] });

describe("taste graph", () => {
  it("finds two communities in two cliques joined by one edge", () => {
    const clique = (from: number) =>
      [0, 1, 2, 3].map(
        (a) => new Map([0, 1, 2, 3].filter((b) => b !== a).map((b) => [from + b, 1])),
      );
    const adjacency = [...clique(0), ...clique(4)];
    adjacency[3].set(4, 0.2);
    adjacency[4].set(3, 0.2);
    const groups = louvain(adjacency);
    expect(new Set(groups.slice(0, 4)).size).toBe(1);
    expect(new Set(groups.slice(4)).size).toBe(1);
    expect(groups[0]).not.toBe(groups[4]);
  });

  it("clusters liked titles into named tastes and skips disliked ones", () => {
    const history = [
      ...[1, 2, 3, 4].map((id) => liked(mystery(id))),
      ...[11, 12, 13].map((id) => liked(sports(id), 0.8, 500)),
      liked(item(99, { genres: ["Horror"] }), -1),
    ];
    const map = buildTasteMap(history, now);
    expect(map.titles).toBe(7);
    expect(map.nodes.some((node) => node.id === "ANIME:99")).toBe(false);
    const labels = map.clusters.map((cluster) => cluster.label);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/Detective|Time Travel|Mystery/);
    expect(labels[1]).toMatch(/Swimming|Teamwork|Sports/);
    // The mystery titles share a hub; the hub links to each of them.
    const hub = map.nodes.find((node) => node.kind === "cluster" && node.label === labels[0])!;
    const spokes = map.links.filter((link) => link.kind === "cluster" && link.source === hub.id);
    expect(spokes.map((link) => link.target).sort()).toEqual(
      ["ANIME:1", "ANIME:2", "ANIME:3", "ANIME:4"].sort(),
    );
    expect(map.clusters[0].trend).toBe("growing");
    expect(map.clusters[1].trend).toBe("fading");
  });

  it("links sequels and a film series, and keeps the node budget by folding weak titles", () => {
    const history = [
      liked(mystery(1)),
      liked(
        item(2, {
          ...mystery(2),
          relations: [{ id: 1, mediaType: "ANIME", relationType: "PREQUEL" }],
        }),
      ),
      ...[20, 21, 22].map((id) =>
        liked(item(id, { mediaType: "MOVIE", collectionId: 7, releaseDate: `20${id}-01-01` })),
      ),
      ...Array.from({ length: 40 }, (_, at) => liked(mystery(100 + at), 0.5, 30 + at)),
    ];
    const map = buildTasteMap(history, now, { budget: 10 });
    expect(map.nodes.filter((node) => node.kind === "title").length).toBeLessThanOrEqual(10);
    const hubs = map.nodes.filter((node) => node.kind === "cluster");
    expect(hubs.reduce((sum, hub) => sum + (hub.folded ?? 0), 0)).toBeGreaterThan(30);
    const series = map.links.filter((link) => link.kind === "series");
    expect(series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "ANIME:1", target: "ANIME:2" }),
        expect.objectContaining({ source: "MOVIE:20", target: "MOVIE:21" }),
      ]),
    );
  });

  it("is deterministic and empty without liked titles", () => {
    const history = [1, 2, 3, 11, 12].map((id) => liked(id > 10 ? sports(id) : mystery(id)));
    expect(buildTasteMap(history, now)).toEqual(buildTasteMap([...history].reverse(), now));
    expect(buildTasteMap([liked(item(1), -1)], now)).toMatchObject({ nodes: [], titles: 0 });
  });

  it("packs vectors without changing their dot products", () => {
    const items = [mystery(1), sports(2), item(3, { genres: ["Mystery", "Sports"] }), item(4)];
    const space = new ContentSpace(items);
    const vectors = items.map((entry) => space.vector(entry));
    const packed = packVectors(vectors);
    for (let a = 0; a < items.length; a += 1)
      for (let b = 0; b < items.length; b += 1)
        expect(packedDot(packed[a], packed[b])).toBeCloseTo(dot(vectors[a], vectors[b]), 12);
  });

  it("fingerprints history so an unchanged map can be reused within the hour", () => {
    const history = [liked(mystery(1)), liked(sports(2))];
    const same = tasteMapFingerprint(history, now);
    expect(tasteMapFingerprint([...history], now + 60_000)).toBe(same);
    expect(tasteMapFingerprint(history, now + 3_600_000)).not.toBe(same);
    expect(tasteMapFingerprint([liked(mystery(1)), liked(sports(2), 0.5)], now)).not.toBe(same);
    expect(tasteMapFingerprint([liked(mystery(1))], now)).not.toBe(same);
  });
});
