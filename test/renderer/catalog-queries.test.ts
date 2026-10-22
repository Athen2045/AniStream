import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListMediaType,
  LatestAnimeUpdate,
  LatestMangaUpdate,
} from "../../src/shared/contracts";
import {
  catalogTrendingQuery,
  latestUpdatesQuery,
  malTrendingQuery,
  type CatalogQueryApi,
  type LatestUpdatesResult,
} from "../../src/renderer/src/catalog-queries";
import { createAppQueryClient } from "../../src/renderer/src/query-client";

function media(id: number, type: AniListMediaType): AniListCatalogMedia {
  return {
    id,
    type,
    title: `${type} ${id}`,
    coverUrl: `https://example.test/${id}.jpg`,
    genres: [],
    siteUrl: `https://anilist.co/${type.toLowerCase()}/${id}`,
  };
}

const pageInfo = (currentPage: number) => ({
  currentPage,
  perPage: 21,
  lastPage: 3,
  hasNextPage: currentPage < 3,
});

function api(overrides: Partial<CatalogQueryApi> = {}): CatalogQueryApi {
  return {
    browseAniList: vi.fn(async () => ({
      pageInfo: { currentPage: 1, perPage: 20, lastPage: 1, hasNextPage: false },
      items: Array.from({ length: 25 }, (_, index) => media(index + 1, "ANIME")),
    })),
    getLatestAnimeUpdates: vi.fn(async (page: number) => ({
      pageInfo: pageInfo(page),
      items: [
        { media: media(100 + page, "ANIME"), episode: page, airedAt: 1 } as LatestAnimeUpdate,
      ],
    })),
    getLatestMangaUpdates: vi.fn(async (page: number) => ({
      pageInfo: pageInfo(page),
      items: [{ chapterId: `c${page}` } as unknown as LatestMangaUpdate],
    })),
    getMalTrendingFallback: vi.fn(async () => []),
    ...overrides,
  };
}

describe("catalog queries", () => {
  it("asks AniList for a section's Trending once per session and keeps the first 20", async () => {
    const bridge = api();
    const client = createAppQueryClient();

    const first = await client.fetchQuery(catalogTrendingQuery("ANIME", bridge));
    await client.fetchQuery(catalogTrendingQuery("ANIME", bridge));

    expect(first).toHaveLength(20);
    expect(bridge.browseAniList).toHaveBeenCalledTimes(1);
    expect(bridge.browseAniList).toHaveBeenCalledWith({
      type: "ANIME",
      page: 1,
      perPage: 20,
      sort: "TRENDING_DESC",
    });
  });

  it("keeps AniList's empty Trending for the session instead of asking again", async () => {
    const bridge = api({
      browseAniList: vi.fn(async () => ({
        pageInfo: { currentPage: 1, perPage: 20, lastPage: 1, hasNextPage: false },
        items: [],
      })),
    });
    const client = createAppQueryClient();

    await expect(client.fetchQuery(catalogTrendingQuery("MANGA", bridge))).resolves.toEqual([]);
    await client.fetchQuery(catalogTrendingQuery("MANGA", bridge));
    expect(bridge.browseAniList).toHaveBeenCalledTimes(1);
  });

  it("asks MyAnimeList for the stand-in ranking of that section", async () => {
    const bridge = api();
    await createAppQueryClient().fetchQuery(malTrendingQuery("MANGA", bridge));
    expect(bridge.getMalTrendingFallback).toHaveBeenCalledWith("MANGA");
  });

  it("loads each Latest Updates page on its own, per section", async () => {
    const bridge = api();
    const client = createAppQueryClient();

    const anime = await client.fetchQuery(latestUpdatesQuery("ANIME", 2, bridge));
    const manga = await client.fetchQuery(latestUpdatesQuery("MANGA", 1, bridge));

    expect(anime.anime.map((update) => update.media.id)).toEqual([102]);
    expect(anime.manga).toEqual([]);
    expect(anime.pageInfo.currentPage).toBe(2);
    expect(manga.manga).toHaveLength(1);
    expect(manga.anime).toEqual([]);
    expect(bridge.getLatestAnimeUpdates).toHaveBeenCalledWith(2);
    expect(bridge.getLatestMangaUpdates).toHaveBeenCalledWith(1);
  });

  it("shows the previous Latest page while the next loads, never another section's", () => {
    const placeholder = latestUpdatesQuery("ANIME", 2, api()).placeholderData as (
      previous: LatestUpdatesResult | undefined,
      previousQuery: { queryKey: readonly unknown[] } | undefined,
    ) => LatestUpdatesResult | undefined;
    const previous: LatestUpdatesResult = { anime: [], manga: [], pageInfo: pageInfo(1) };

    expect(placeholder(previous, { queryKey: ["catalog", "latest", "ANIME", 1] })).toBe(previous);
    expect(placeholder(previous, { queryKey: ["catalog", "latest", "MANGA", 1] })).toBeUndefined();
  });
});
