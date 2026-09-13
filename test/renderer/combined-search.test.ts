import { describe, expect, it } from "vitest";
import { combinedSearch } from "../../src/renderer/src/combined-search";

describe("combined AniList search", () => {
  it("keeps the successful media type when the other fails", async () => {
    const result = await combinedSearch("garden", {
      browseAniList: async (input) => {
        if (input.type === "MANGA") throw new Error("timeout");
        return {
          items: [
            { id: 42, type: "ANIME", title: "Garden", coverUrl: "", siteUrl: "", genres: [] },
          ],
          pageInfo: { currentPage: 1, perPage: 4, lastPage: 1, hasNextPage: false },
        };
      },
    });
    expect(result.items.map((row) => row.id)).toEqual([42]);
    expect(result.failedTypes).toEqual(["MANGA"]);
  });
  it("distinguishes an empty search from a complete outage", async () => {
    const empty = await combinedSearch("garden", {
      browseAniList: async () => ({
        items: [],
        pageInfo: { currentPage: 1, perPage: 4, lastPage: 1, hasNextPage: false },
      }),
    });
    expect(empty).toEqual({ items: [], failedTypes: [] });
    const failed = await combinedSearch("garden", {
      browseAniList: async () => {
        throw new Error("429");
      },
    });
    expect(failed).toEqual({ items: [], failedTypes: ["ANIME", "MANGA"] });
  });
});
