import { describe, expect, it } from "vitest";
import { normalizeSeriesGraph } from "../../src/main/anilist/normalize";

const node = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: "ANIME",
  title: { userPreferred: `Title ${id}`, english: `English ${id}`, romaji: `Romaji ${id}` },
  synonyms: [`Alt ${id}`],
  coverImage: { large: `https://s4.anilist.co/${id}.jpg` },
  siteUrl: `https://anilist.co/anime/${id}`,
  format: "TV",
  episodes: 12,
  ...extra,
});

describe("normalizeSeriesGraph", () => {
  it("keeps two hops of season relations and drops manga, other relation types and bad nodes", () => {
    const graph = normalizeSeriesGraph(
      node(1, {
        relations: {
          edges: [
            {
              relationType: "SEQUEL",
              node: node(2, {
                relations: {
                  edges: [
                    { relationType: "PREQUEL", node: node(1) },
                    { relationType: "SEQUEL", node: node(3) },
                  ],
                },
              }),
            },
            { relationType: "ADAPTATION", node: { ...node(9), type: "MANGA" } },
            { relationType: "CHARACTER", node: node(8) },
            { relationType: "SIDE_STORY", node: { id: 7, type: "ANIME" } },
          ],
        },
      }),
    );
    const byId = new Map(graph.map((entry) => [entry.media.id, entry]));
    expect([...byId.keys()].sort()).toEqual([1, 2, 3]);
    expect(byId.get(1)?.relations?.map((row) => [row.relationType, row.media.id])).toEqual([
      ["SEQUEL", 2],
    ]);
    expect(byId.get(2)?.relations?.map((row) => row.media.id)).toEqual([1, 3]);
    // The outer ring carries no relations of its own.
    expect(byId.get(3)?.relations).toBeUndefined();
    expect(byId.get(1)?.titles).toEqual(["English 1", "Romaji 1", "Alt 1"]);
  });

  it("returns nothing for a malformed root", () => {
    expect(normalizeSeriesGraph(null)).toEqual([]);
    expect(normalizeSeriesGraph({ id: 1, type: "MANGA" })).toEqual([]);
  });
});
