import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniStreamBridge,
  MoreCatalogItem,
} from "../../src/shared/contracts";
import { catalogTrendingQuery } from "../../src/renderer/src/catalog-queries";
import { emptyFilters } from "../../src/renderer/src/catalog-filters";
import { emptyMoreFilters } from "../../src/renderer/src/more-filter-state";
import { createAppQueryClient } from "../../src/renderer/src/query-client";
import {
  didYouMeanQuery,
  mergeSearchPages,
  searchResultsQuery,
  searchTrendingQuery,
  type SearchResults,
} from "../../src/renderer/src/search-queries";

function media(id: number, title = `Title ${id}`): AniListCatalogMedia {
  return { id, type: "ANIME", title, coverUrl: "", genres: [], siteUrl: "" };
}
function catalogPage(page: number, ids: number[], hasNext: boolean): AniListCatalogPage {
  return {
    pageInfo: {
      currentPage: page,
      perPage: 30,
      lastPage: hasNext ? page + 1 : page,
      hasNextPage: hasNext,
    },
    items: ids.map((id) => media(id)),
  };
}
const more = (id: number): MoreCatalogItem =>
  ({ id, type: "MOVIE", title: `Movie ${id}`, genres: [] }) as unknown as MoreCatalogItem;

type Api = Parameters<typeof searchResultsQuery>[1] & Parameters<typeof catalogTrendingQuery>[1];
function api(overrides: Partial<AniStreamBridge> = {}): Api {
  return {
    browseAniList: vi.fn(async (input) =>
      catalogPage(input.page, [input.page * 10], input.page < 2),
    ),
    browseMore: vi.fn(),
    searchMore: vi.fn(),
    getMoreTrending: vi.fn(),
    getLatestAnimeUpdates: vi.fn(),
    getLatestMangaUpdates: vi.fn(),
    getMalTrendingFallback: vi.fn(),
    getAniListFilterOptions: vi.fn(),
    getAniListPersonTitles: vi.fn(),
    ...overrides,
  } as unknown as Api;
}

const request = (query: string) => ({
  scope: "ANIME" as const,
  query,
  filters: emptyFilters(),
  moreFilters: emptyMoreFilters(),
  moreFiltered: false,
});

describe("search queries", () => {
  it("loads AniList result pages on request and shows them as one list", async () => {
    const bridge = api();
    const client = createAppQueryClient();
    const options = searchResultsQuery(request("Frieren"), bridge);

    // The first page, then one "Show more".
    const data = await client.fetchInfiniteQuery({ ...options, pages: 2 });
    const merged = mergeSearchPages(data);

    expect(merged).toMatchObject({ kind: "anilist", page: 2, hasNext: false });
    expect(merged.items.map((item) => item.id)).toEqual([10, 20]);
    expect(vi.mocked(bridge.browseAniList).mock.calls.map(([input]) => input.page)).toEqual([1, 2]);
  });

  it("never repeats a movie or show across Show more batches", () => {
    const pages: SearchResults[] = [
      { kind: "more", items: [more(1), more(2)], next: { MOVIE: 2 } },
      { kind: "more", items: [more(2), more(3)], next: {} },
    ];
    const merged = mergeSearchPages({ pages, pageParams: [] });
    expect(merged.items.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("shows the section's own Trending under an empty field without asking AniList again", async () => {
    const bridge = api({
      browseAniList: vi.fn(async () =>
        catalogPage(
          1,
          Array.from({ length: 20 }, (_, i) => i),
          false,
        ),
      ),
    });
    const client = createAppQueryClient();

    await client.fetchQuery(catalogTrendingQuery("ANIME", bridge));
    const trending = await client.fetchQuery(searchTrendingQuery("ANIME", bridge));

    expect(trending.items).toHaveLength(16);
    expect(bridge.browseAniList).toHaveBeenCalledTimes(1);
  });

  it("offers the closest popular title for a typo, or nothing", async () => {
    const bridge = api({
      browseAniList: vi.fn(async () => ({
        ...catalogPage(1, [], false),
        items: [media(1, "Frieren"), media(2, "Fire Force")],
      })),
    });
    const client = createAppQueryClient();

    await expect(client.fetchQuery(didYouMeanQuery("ANIME", "Freiren", bridge))).resolves.toBe(
      "Frieren",
    );
    await expect(
      client.fetchQuery(didYouMeanQuery("ANIME", "Completely different", bridge)),
    ).resolves.toBeNull();
    expect(vi.mocked(bridge.browseAniList).mock.calls[0]?.[0]).toMatchObject({
      query: "Freiren",
      sort: "POPULARITY_DESC",
    });
  });
});
