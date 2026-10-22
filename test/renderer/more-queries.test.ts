import { describe, expect, it, vi } from "vitest";
import type { MoreCatalogPage } from "../../src/shared/contracts";
import {
  moreForYouQuery,
  moreTrendingKey,
  moreTrendingQuery,
} from "../../src/renderer/src/more-queries";
import type { MoreDiscoveryFeed } from "../../src/shared/discovery";
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

describe("moreForYouQuery", () => {
  const feed = (requestId: string): MoreDiscoveryFeed => ({
    status: "ready",
    items: [],
    requestId,
  });

  it("may use the saved feed first and asks for a rebuild on every reload", async () => {
    const api = {
      getMoreForYou: vi.fn(async (fresh?: boolean) => feed(fresh ? "rebuilt" : "saved")),
    };
    const client = createAppQueryClient();

    const first = await client.fetchQuery(moreForYouQuery("guest", api));
    await client.refetchQueries({ queryKey: moreForYouQuery("guest", api).queryKey });

    expect(first.requestId).toBe("saved");
    expect(client.getQueryData(moreForYouQuery("guest", api).queryKey)?.requestId).toBe("rebuilt");
    expect(api.getMoreForYou.mock.calls).toEqual([[false], [true]]);
  });

  it("keeps one feed per viewer", async () => {
    const api = { getMoreForYou: vi.fn(async () => feed("any")) };
    const client = createAppQueryClient();

    await client.fetchQuery(moreForYouQuery("guest", api));
    await client.fetchQuery(moreForYouQuery("123", api));
    await client.fetchQuery(moreForYouQuery("guest", api));

    expect(api.getMoreForYou).toHaveBeenCalledTimes(2);
  });
});
