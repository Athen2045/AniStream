import { describe, expect, it, vi } from "vitest";
import type { MoreCatalogPage } from "../../src/shared/contracts";
import { moreTrendingKey, moreTrendingQuery } from "../../src/renderer/src/more-queries";
import { createAppQueryClient } from "../../src/renderer/src/query-client";

function page(currentPage: number): MoreCatalogPage {
  return {
    pageInfo: { currentPage, totalPages: 2, totalResults: 2, hasNextPage: currentPage < 2 },
    items: [{ id: currentPage, type: "MOVIE", title: `Movie ${currentPage}`, genres: [] }],
  } as MoreCatalogPage;
}

describe("moreTrendingQuery", () => {
  it("asks the bridge once per page for the whole session", async () => {
    const api = { getMoreTrending: vi.fn(async (_type: string, n: number) => page(n)) };
    const client = createAppQueryClient();

    await client.fetchQuery(moreTrendingQuery("MOVIE", 1, api));
    await client.fetchQuery(moreTrendingQuery("MOVIE", 1, api));
    const second = await client.fetchQuery(moreTrendingQuery("MOVIE", 2, api));

    expect(second.pageInfo.currentPage).toBe(2);
    expect(api.getMoreTrending.mock.calls).toEqual([
      ["MOVIE", 1],
      ["MOVIE", 2],
    ]);
  });

  it("does not retry a failed page and asks again after a reset", async () => {
    const api = {
      getMoreTrending: vi
        .fn<(type: string, n: number) => Promise<MoreCatalogPage>>()
        .mockRejectedValueOnce(new Error("TMDB request failed (500)."))
        .mockResolvedValue(page(1)),
    };
    const client = createAppQueryClient();

    await expect(client.fetchQuery(moreTrendingQuery("TV", 1, api))).rejects.toThrow("500");
    expect(api.getMoreTrending).toHaveBeenCalledTimes(1);

    await client.resetQueries({ queryKey: moreTrendingKey });
    await expect(client.fetchQuery(moreTrendingQuery("TV", 1, api))).resolves.toEqual(page(1));
  });
});
