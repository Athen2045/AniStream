import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListMediaType,
  LatestAnimeUpdate,
  LatestUpdatesPage,
} from "../../src/shared/contracts";
import { createCatalogDataModule, type CatalogDataApi } from "../../src/renderer/src/catalog-data";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

function catalogPage(item: AniListCatalogMedia): AniListCatalogPage {
  return {
    pageInfo: { currentPage: 1, perPage: 20, lastPage: 1, hasNextPage: false },
    items: [item],
  };
}

function latestPage(page: number, item: LatestAnimeUpdate): LatestUpdatesPage<LatestAnimeUpdate> {
  return {
    pageInfo: { currentPage: page, perPage: 21, lastPage: 3, hasNextPage: page < 3 },
    items: [item],
  };
}

function api(overrides: Partial<CatalogDataApi>): CatalogDataApi {
  return {
    browseAniList: vi.fn(async () => catalogPage(media(900, "ANIME"))),
    getLatestAnimeUpdates: vi.fn(async () => ({
      pageInfo: { currentPage: 1, perPage: 21, lastPage: 1, hasNextPage: false },
      items: [],
    })),
    getLatestMangaUpdates: vi.fn(async () => ({
      pageInfo: { currentPage: 1, perPage: 21, lastPage: 1, hasNextPage: false },
      items: [],
    })),
    getMalTrendingFallback: vi.fn(async () => []),
    getMangaDexAvailability: vi.fn(async () => []),
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("catalog data request lifecycle", () => {
  it("retries an abandoned Anime trending request after Manga is selected and Anime is restored", async () => {
    const abandonedAnime = deferred<AniListCatalogPage>();
    const manga = deferred<AniListCatalogPage>();
    const retriedAnime = deferred<AniListCatalogPage>();
    const browseAniList = vi
      .fn<CatalogDataApi["browseAniList"]>()
      .mockReturnValueOnce(abandonedAnime.promise)
      .mockReturnValueOnce(manga.promise)
      .mockReturnValueOnce(retriedAnime.promise);
    const catalog = createCatalogDataModule(api({ browseAniList }));

    catalog.activate({ type: "ANIME", availabilityMedia: [] });
    catalog.activate({ type: "MANGA", availabilityMedia: [] });
    catalog.activate({ type: "ANIME", availabilityMedia: [] });

    expect(browseAniList.mock.calls.map(([input]) => input.type)).toEqual([
      "ANIME",
      "MANGA",
      "ANIME",
    ]);

    abandonedAnime.resolve(catalogPage(media(1, "ANIME")));
    await settle();
    expect(catalog.getSnapshot().trending).toEqual([]);

    retriedAnime.resolve(catalogPage(media(2, "ANIME")));
    await settle();
    expect(catalog.getSnapshot().trending.map((item) => item.id)).toEqual([2]);

    catalog.dispose();
  });

  it("falls back to MAL trending when AniList returns an empty trending page", async () => {
    const getMalTrendingFallback = vi.fn<CatalogDataApi["getMalTrendingFallback"]>(async () => [
      { malId: 1, title: "Fallback", malUrl: "https://myanimelist.net/manga/1" },
    ]);
    const catalog = createCatalogDataModule(
      api({
        browseAniList: vi.fn(async () => ({
          pageInfo: { currentPage: 1, perPage: 20, lastPage: 1, hasNextPage: false },
          items: [],
        })),
        getMalTrendingFallback,
      }),
    );

    catalog.activate({ type: "MANGA", availabilityMedia: [] });
    await settle();
    await settle();

    expect(getMalTrendingFallback).toHaveBeenCalledWith("MANGA");
    expect(catalog.getSnapshot().malTrendingFallback.map((item) => item.title)).toEqual([
      "Fallback",
    ]);
    catalog.dispose();
  });

  it("rejects a stale Latest Anime page after a newer page has rendered", async () => {
    const firstPage = deferred<LatestUpdatesPage<LatestAnimeUpdate>>();
    const secondPage = deferred<LatestUpdatesPage<LatestAnimeUpdate>>();
    const getLatestAnimeUpdates = vi
      .fn<CatalogDataApi["getLatestAnimeUpdates"]>()
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);
    const catalog = createCatalogDataModule(api({ getLatestAnimeUpdates }));

    catalog.activate({ type: "ANIME", availabilityMedia: [] });
    catalog.setLatestPage(2);

    secondPage.resolve(latestPage(2, { media: media(22, "ANIME"), episode: 4, airedAt: 22 }));
    await settle();
    expect(catalog.getSnapshot()).toMatchObject({
      latestPage: 2,
      latestAnime: [{ media: { id: 22 } }],
      latestLoading: false,
    });

    firstPage.resolve(latestPage(1, { media: media(11, "ANIME"), episode: 3, airedAt: 11 }));
    await settle();
    expect(catalog.getSnapshot()).toMatchObject({
      latestPage: 2,
      latestAnime: [{ media: { id: 22 } }],
      latestLoading: false,
    });

    catalog.dispose();
  });

  it("skips Latest Updates while the viewer has them off and loads them when turned on", async () => {
    const getLatestAnimeUpdates = vi.fn<CatalogDataApi["getLatestAnimeUpdates"]>(async () =>
      latestPage(1, { media: media(31, "ANIME"), episode: 2, airedAt: 31 }),
    );
    const getLatestMangaUpdates = vi.fn<CatalogDataApi["getLatestMangaUpdates"]>();
    const catalog = createCatalogDataModule(api({ getLatestAnimeUpdates, getLatestMangaUpdates }));

    catalog.activate({ type: "ANIME", availabilityMedia: [], latest: false });
    catalog.activate({ type: "MANGA", availabilityMedia: [], latest: false });
    await settle();
    expect(getLatestAnimeUpdates).not.toHaveBeenCalled();
    expect(getLatestMangaUpdates).not.toHaveBeenCalled();

    catalog.activate({ type: "ANIME", availabilityMedia: [], latest: false });
    catalog.activate({ type: "ANIME", availabilityMedia: [], latest: true });
    await settle();
    expect(getLatestAnimeUpdates).toHaveBeenCalledTimes(1);
    expect(catalog.getSnapshot()).toMatchObject({
      latestAnime: [{ media: { id: 31 } }],
      latestLoading: false,
    });

    catalog.dispose();
  });
});
