import { describe, expect, it, vi } from "vitest";
import type { AniListCatalogPage, BrowseAniListInput } from "../../src/shared/contracts";
import { createSearchSession, type SearchFilters } from "../../src/renderer/src/search-session";

const filters: SearchFilters = { query: "garden", type: "ALL", genre: "", sort: "POPULARITY_DESC" };
function page(input: BrowseAniListInput): AniListCatalogPage {
  return {
    items: [
      {
        id: input.page,
        type: input.type,
        title: input.query ?? "",
        coverUrl: "",
        siteUrl: "",
        genres: [],
      },
    ],
    pageInfo: { currentPage: input.page, perPage: 24, lastPage: 3, hasNextPage: input.page < 3 },
  };
}
describe("unified search session", () => {
  it("pages only the requested type and resets both groups when filters change", async () => {
    const browseAniList = vi.fn(async (input: BrowseAniListInput) => page(input));
    const session = createSearchSession({ browseAniList });
    await session.search(filters);
    expect(browseAniList).toHaveBeenCalledTimes(2);
    expect(browseAniList.mock.calls.map(([input]) => [input.type, input.perPage])).toEqual([
      ["ANIME", 24],
      ["MANGA", 24],
    ]);
    const manga = session.getSnapshot().groups.MANGA;
    await session.page("ANIME", 2);
    expect(session.getSnapshot().groups.ANIME.page).toBe(2);
    expect(session.getSnapshot().groups.MANGA).toBe(manga);
    await session.search({ ...filters, genre: " Adventure ", sort: "SCORE_DESC" });
    expect(session.getSnapshot().groups.ANIME.page).toBe(1);
    expect(browseAniList.mock.calls.at(-1)?.[0]).toMatchObject({
      genre: "Adventure",
      sort: "SCORE_DESC",
    });
  });
  it("retains successful results and retries the failed page rather than page one", async () => {
    let failure = true;
    const browseAniList = vi.fn(async (input: BrowseAniListInput) => {
      if (input.type === "MANGA" && input.page === 2 && failure) throw new Error("timeout");
      return page(input);
    });
    const session = createSearchSession({ browseAniList });
    await session.search(filters);
    const anime = session.getSnapshot().groups.ANIME;
    await session.page("MANGA", 2);
    expect(session.getSnapshot().groups.MANGA).toMatchObject({
      page: 1,
      error: expect.stringMatching(/taking longer|previous search results/i),
      loading: false,
    });
    expect(session.getSnapshot().groups.MANGA.result?.items).toHaveLength(1);
    expect(session.getSnapshot().groups.ANIME).toBe(anime);
    failure = false;
    await session.retry("MANGA");
    expect(session.getSnapshot().groups.MANGA).toMatchObject({ page: 2, error: undefined });
  });
  it("ignores old queries and results arriving after disposal, and supports reactivation", async () => {
    let finish: (value: AniListCatalogPage) => void = () => {};
    const session = createSearchSession({
      browseAniList: (input) =>
        input.query === "old"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(page(input)),
    });
    const old = session.search({ ...filters, type: "ANIME", query: "old" });
    await session.search({ ...filters, type: "ANIME", query: "new" });
    finish(page({ type: "ANIME", page: 1, query: "old" }));
    await old;
    expect(session.getSnapshot().groups.ANIME.result?.items[0].title).toBe("new");
    const pending = session.search({ ...filters, type: "ANIME", query: "old" });
    session.dispose();
    const snapshot = session.getSnapshot();
    finish(page({ type: "ANIME", page: 1, query: "old" }));
    await pending;
    expect(session.getSnapshot()).toBe(snapshot);
    session.activate();
    await session.search({ ...filters, type: "MANGA" });
    expect(session.getSnapshot().groups.MANGA.result?.items).toHaveLength(1);
  });
  it("bounds short-query and type-specific requests, and distinguishes empty from unavailable", async () => {
    const browseAniList = vi.fn(async (input: BrowseAniListInput) => ({
      ...page(input),
      items: [],
    }));
    const session = createSearchSession({ browseAniList });
    await session.search({ ...filters, query: " a " });
    expect(browseAniList).not.toHaveBeenCalled();
    await session.search({ ...filters, type: "MANGA" });
    expect(browseAniList).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().groups.MANGA).toMatchObject({
      error: undefined,
      loading: false,
      result: { items: [] },
    });
    await session.page("ANIME", 2);
    expect(browseAniList).toHaveBeenCalledTimes(1);
  });
  it("reports a category outage without discarding the other category", async () => {
    const session = createSearchSession({
      browseAniList: async (input) => {
        if (input.type === "MANGA") throw new Error("429: retry later");
        return page(input);
      },
    });
    await session.search(filters);
    expect(session.getSnapshot().groups.ANIME.result?.items).toHaveLength(1);
    expect(session.getSnapshot().groups.MANGA).toMatchObject({
      error: expect.stringMatching(/AniList is busy|few minutes/i),
      loading: false,
    });
    expect(session.getSnapshot().groups.MANGA.result).toBeUndefined();
  });
});
