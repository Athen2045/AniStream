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
  profileSearchQuery,
  type ProfileSearchFilters,
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
    getTitleSuggestions: vi.fn(async () => []),
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

  it("labels results with their search and keeps them on screen while the next one loads", async () => {
    const bridge = api();
    const client = createAppQueryClient();
    const first = searchResultsQuery(request("One Pi"), bridge);
    const data = await client.fetchInfiniteQuery(first);
    expect(mergeSearchPages(data).query).toBe("One Pi");

    const keep = (next: ReturnType<typeof searchResultsQuery>) => {
      const placeholder = next.placeholderData as unknown as (
        previous: unknown,
        previousQuery: { queryKey: readonly unknown[] },
      ) => unknown;
      return placeholder(data, { queryKey: first.queryKey });
    };
    // Same section and filters: the previous search stays (dimmed) until "One Piece" answers.
    expect(keep(searchResultsQuery(request("One Piece"), bridge))).toBe(data);
    // A fresh search (other first letters) never shows the old titles.
    expect(keep(searchResultsQuery(request("Bl"), bridge))).toBe(undefined);
    // Another section or other filters never show the old results.
    expect(keep(searchResultsQuery({ ...request("One Piece"), scope: "MANGA" }, bridge))).toBe(
      undefined,
    );
    expect(
      keep(
        searchResultsQuery(
          { ...request("One Piece"), filters: { ...emptyFilters(), genre: "Action" } },
          bridge,
        ),
      ),
    ).toBe(undefined);
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

  it("asks the typo-tolerant search only when AniList has no close title", async () => {
    // AniList matches whole words: a misspelled first word finds nothing, a real title does.
    const found = new Set(["Frieren: Beyond Journey's End", "Naruto"]);
    const bridge = api({
      browseAniList: vi.fn(async (input) => ({
        ...catalogPage(1, [], false),
        items: found.has(input.query ?? "") ? [media(1, input.query ?? "")] : [],
      })),
      getTitleSuggestions: vi.fn(async (_type, query) =>
        query === "Narto"
          ? ["Naruto: Shippuuden", "Naruto: Shippuden", "Naruto", "Boruto"]
          : ["Sousou no Frieren", "Frieren: Beyond Journey's End", "Haru"],
      ),
    });
    const client = createAppQueryClient();

    await expect(client.fetchQuery(didYouMeanQuery("ANIME", "Frierne", bridge))).resolves.toBe(
      "Frieren: Beyond Journey's End",
    );
    expect(bridge.getTitleSuggestions).toHaveBeenCalledWith("ANIME", "Frierne");
    // Equally close names prefer the nearest whole title, and only names AniList finds count.
    await expect(client.fetchQuery(didYouMeanQuery("ANIME", "Narto", bridge))).resolves.toBe(
      "Naruto",
    );
    // A far-off name from that search is still not offered.
    await expect(client.fetchQuery(didYouMeanQuery("ANIME", "Zzqx", bridge))).resolves.toBeNull();
  });

  it("offers nothing AniList cannot find", async () => {
    const bridge = api({
      browseAniList: vi.fn(async () => catalogPage(1, [], false)),
      getTitleSuggestions: vi.fn(async () => ["Naruto: Shippuuden"]),
    });
    await expect(
      createAppQueryClient().fetchQuery(didYouMeanQuery("ANIME", "Narto", bridge)),
    ).resolves.toBeNull();
  });

  it("keeps quiet when the typo-tolerant search fails", async () => {
    const bridge = api({
      browseAniList: vi.fn(async () => catalogPage(1, [], false)),
      getTitleSuggestions: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(
      createAppQueryClient().fetchQuery(didYouMeanQuery("ANIME", "Frierne", bridge)),
    ).resolves.toBeNull();
  });
});

describe("profileSearchQuery", () => {
  const filters: ProfileSearchFilters = {
    query: "Frieren",
    type: "ALL",
    genre: "",
    sort: "POPULARITY_DESC",
  };

  it("asks for one section's page of 24 and leaves an empty genre out", async () => {
    const bridge = api();
    await createAppQueryClient().fetchQuery(profileSearchQuery("MANGA", filters, 2, bridge));
    expect(bridge.browseAniList).toHaveBeenCalledWith({
      type: "MANGA",
      page: 2,
      perPage: 24,
      query: "Frieren",
      genre: undefined,
      sort: "POPULARITY_DESC",
    });
  });

  it("keeps the previous page on screen only within the same search and section", () => {
    const placeholder = profileSearchQuery("ANIME", filters, 2, api()).placeholderData as (
      previous: AniListCatalogPage | undefined,
      previousQuery: { queryKey: readonly unknown[] } | undefined,
    ) => AniListCatalogPage | undefined;
    const previous = catalogPage(1, [1], true);
    const key = (type: string, query: string, page: number) => ({
      queryKey: ["search", "profile", type, query, "", "POPULARITY_DESC", page],
    });

    expect(placeholder(previous, key("ANIME", "Frieren", 1))).toBe(previous);
    expect(placeholder(previous, key("ANIME", "Naruto", 1))).toBeUndefined();
    expect(placeholder(previous, key("MANGA", "Frieren", 1))).toBeUndefined();
  });
});
