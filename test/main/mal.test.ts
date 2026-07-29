import { describe, expect, it } from "vitest";
import { MalClient, parseMalRanking, parseMalScore } from "../../src/main/mal";

describe("parseMalScore", () => {
  it("parses a complete score payload", () => {
    expect(
      parseMalScore({ id: 21, mean: 8.71, rank: 92, num_scoring_users: 1_500_000 }, "anime"),
    ).toEqual({
      malId: 21,
      score: 8.71,
      rank: 92,
      scoredBy: 1_500_000,
      malUrl: "https://myanimelist.net/anime/21",
    });
  });

  it("tolerates missing optional fields and builds manga URLs", () => {
    const score = parseMalScore({ id: 13 }, "manga");
    expect(score).toEqual({
      malId: 13,
      score: undefined,
      rank: undefined,
      scoredBy: undefined,
      malUrl: "https://myanimelist.net/manga/13",
    });
  });

  it("returns undefined for malformed payloads", () => {
    expect(parseMalScore(undefined, "anime")).toBeUndefined();
    expect(parseMalScore({ mean: 8 }, "anime")).toBeUndefined();
    expect(parseMalScore({ id: -2 }, "anime")).toBeUndefined();
  });
});

describe("parseMalRanking", () => {
  it("parses ranking nodes with covers and scores", () => {
    const ranking = parseMalRanking(
      {
        data: [
          {
            node: {
              id: 5114,
              title: "Fullmetal Alchemist: Brotherhood",
              mean: 9.1,
              main_picture: { large: "https://cdn.myanimelist.net/images/anime/1223/96541l.jpg" },
            },
          },
          { node: { id: 0, title: "invalid id" } },
          { node: { id: 30, title: "   " } },
          "garbage",
        ],
      },
      "anime",
    );
    expect(ranking).toEqual([
      {
        malId: 5114,
        title: "Fullmetal Alchemist: Brotherhood",
        coverUrl: "https://cdn.myanimelist.net/images/anime/1223/96541l.jpg",
        score: 9.1,
        malUrl: "https://myanimelist.net/anime/5114",
      },
    ]);
  });

  it("rejects non-https cover URLs but keeps the row", () => {
    const ranking = parseMalRanking(
      { data: [{ node: { id: 1, title: "T", main_picture: { large: "http://insecure" } } }] },
      "manga",
    );
    expect(ranking[0].coverUrl).toBeUndefined();
    expect(ranking[0].malUrl).toBe("https://myanimelist.net/manga/1");
  });

  it("returns an empty list for malformed payloads", () => {
    expect(parseMalRanking(undefined, "anime")).toEqual([]);
    expect(parseMalRanking({ data: "nope" }, "anime")).toEqual([]);
  });
});

describe("MalClient configuration gate", () => {
  it("reports unconfigured and returns empty results without a client ID", async () => {
    const client = new MalClient(undefined);
    expect(client.configured).toBe(false);
    expect(await client.getScore("ANIME", 21)).toBeUndefined();
    expect(await client.getRanking("ANIME")).toEqual([]);
  });
});
