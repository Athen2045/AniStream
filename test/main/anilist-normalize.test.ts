import { describe, expect, it } from "vitest";
import {
  normalizeCatalogMedia,
  normalizeCatalogPage,
  normalizeGroups,
  normalizeMediaDetail,
  normalizeProfile,
} from "../../src/main/anilist/normalize";
import catalogMediaFixture from "../fixtures/anilist/catalog-media.json";
import dashboardFixture from "../fixtures/anilist/dashboard.json";
import mediaDetailFixture from "../fixtures/anilist/media-detail.json";
import viewerFixture from "../fixtures/anilist/viewer.json";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("normalizeProfile", () => {
  it("normalizes a complete Viewer response", () => {
    const profile = normalizeProfile(viewerFixture);
    expect(profile).toEqual({
      id: 123456,
      name: "Athen101",
      about: "<p>Anime fan.</p>",
      avatarUrl: "https://s4.anilist.co/file/anilistcdn/user/avatar/large/123456.png",
      bannerUrl: "https://s4.anilist.co/file/anilistcdn/user/banner/123456.jpg",
      siteUrl: "https://anilist.co/user/123456",
      animeCount: 210,
      episodesWatched: 5312,
      minutesWatched: 127488,
      mangaCount: 48,
      chaptersRead: 3021,
      volumesRead: 214,
    });
  });

  it("tolerates a missing optional 'about' field", () => {
    const fixture = clone(viewerFixture) as Record<string, unknown>;
    delete fixture.about;
    expect(normalizeProfile(fixture).about).toBeUndefined();
  });

  it("throws when a required field is missing", () => {
    const fixture = clone(viewerFixture) as Record<string, unknown>;
    delete fixture.name;
    expect(() => normalizeProfile(fixture)).toThrow(/invalid profile name/);
  });

  it("throws when the response is not an object", () => {
    expect(() => normalizeProfile(null)).toThrow(/invalid profile/);
    expect(() => normalizeProfile("nope")).toThrow(/invalid profile/);
  });
});

describe("normalizeCatalogMedia", () => {
  it("normalizes a complete catalog media entry", () => {
    const media = normalizeCatalogMedia(catalogMediaFixture, "ANIME");
    expect(media.id).toBe(21);
    expect(media.title).toBe("ONE PIECE");
    expect(media.coverUrl).toBe(
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b21-extralarge.jpg",
    );
    expect(media.genres).toEqual(["Action", "Adventure", "Comedy"]);
    expect(media.nextAiringEpisode).toEqual({ episode: 1123, airingAt: 1893456000 });
  });

  it("falls back through userPreferred -> english -> romaji for the title", () => {
    const fixture = clone(catalogMediaFixture) as any;
    delete fixture.title.userPreferred;
    expect(normalizeCatalogMedia(fixture, "ANIME").title).toBe("One Piece");

    delete fixture.title.english;
    fixture.title.romaji = "Wan Pisu";
    expect(normalizeCatalogMedia(fixture, "ANIME").title).toBe("Wan Pisu");
  });

  it("throws when every title variant is missing", () => {
    const fixture = clone(catalogMediaFixture) as any;
    fixture.title = {};
    expect(() => normalizeCatalogMedia(fixture, "ANIME")).toThrow(/without a title/);
  });

  it("falls back from extraLarge to large cover art", () => {
    const fixture = clone(catalogMediaFixture) as any;
    delete fixture.coverImage.extraLarge;
    expect(normalizeCatalogMedia(fixture, "ANIME").coverUrl).toBe(
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b21-large.jpg",
    );
  });

  it("throws on a media type mismatch", () => {
    expect(() => normalizeCatalogMedia(catalogMediaFixture, "MANGA")).toThrow(
      /mismatched media type/,
    );
  });

  it("defaults genres to an empty array when the field is missing or malformed", () => {
    const fixture = clone(catalogMediaFixture) as any;
    delete fixture.genres;
    expect(normalizeCatalogMedia(fixture, "ANIME").genres).toEqual([]);
  });
});

describe("normalizeCatalogPage", () => {
  it("normalizes a page of catalog media", () => {
    const page = normalizeCatalogPage(
      {
        pageInfo: { currentPage: 1, perPage: 20, lastPage: 5, hasNextPage: true },
        media: [catalogMediaFixture],
      },
      "ANIME",
    );
    expect(page.pageInfo).toEqual({ currentPage: 1, perPage: 20, lastPage: 5, hasNextPage: true });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(21);
  });

  it("clamps lastPage so it is never below the current page", () => {
    const page = normalizeCatalogPage(
      { pageInfo: { currentPage: 7, perPage: 20, lastPage: 3, hasNextPage: false }, media: [] },
      "ANIME",
    );
    expect(page.pageInfo.lastPage).toBe(7);
  });

  it("handles an empty result page", () => {
    const page = normalizeCatalogPage(
      { pageInfo: { currentPage: 1, perPage: 20, lastPage: 1, hasNextPage: false }, media: [] },
      "ANIME",
    );
    expect(page.items).toEqual([]);
  });

  it("throws when the media list is missing", () => {
    expect(() =>
      normalizeCatalogPage({ pageInfo: { currentPage: 1, perPage: 20 } }, "ANIME"),
    ).toThrow(/invalid catalog results/);
  });
});

describe("normalizeMediaDetail", () => {
  it("normalizes a complete media detail response", () => {
    const detail = normalizeMediaDetail(mediaDetailFixture, "ANIME");

    expect(detail.titleNative).toBe("ワンピース");
    expect(detail.studios).toEqual(["Toei Animation"]);
    expect(detail.producers).toEqual(["Shueisha"]);
    expect(detail.characters).toEqual([
      {
        id: 40,
        name: "Monkey D. Luffy",
        imageUrl: "https://s4.anilist.co/file/anilistcdn/character/medium/40.png",
        role: "MAIN",
      },
    ]);
    expect(detail.staff[0].name).toBe("Eiichiro Oda");
    expect(detail.relations).toEqual([
      { relationType: "ADAPTATION", media: expect.objectContaining({ id: 30013, type: "MANGA" }) },
    ]);
    expect(detail.recommendations[0].id).toBe(20);
    expect(detail.externalLinks).toEqual([
      { site: "Official Site", url: "https://one-piece.com", type: "INFO" },
    ]);
    expect(detail.trailerUrl).toBe("https://www.youtube.com/watch?v=S1t62QioIt8");
    expect(detail.startDate).toBe("1999-10-20");
    expect(detail.endDate).toBeUndefined();
    expect(detail.listEntry).toEqual({ id: 987654, status: "CURRENT", score: 9, progress: 1122 });
  });

  it("falls back to producers when no studio is marked as main", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.studios.edges = [{ isMain: false, node: { name: "Shueisha" } }];
    const detail = normalizeMediaDetail(fixture, "ANIME");
    expect(detail.studios).toEqual(["Shueisha"]);
  });

  it("builds a Dailymotion trailer URL", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.trailer = { id: "abc123", site: "dailymotion" };
    expect(normalizeMediaDetail(fixture, "ANIME").trailerUrl).toBe(
      "https://www.dailymotion.com/video/abc123",
    );
  });

  it("omits the trailer URL for an unrecognized host or missing trailer", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.trailer = { id: "abc123", site: "vimeo" };
    expect(normalizeMediaDetail(fixture, "ANIME").trailerUrl).toBeUndefined();

    delete fixture.trailer;
    expect(normalizeMediaDetail(fixture, "ANIME").trailerUrl).toBeUndefined();
  });

  it("omits the list entry when the status is unrecognized", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.mediaListEntry.status = "SOMETHING_NEW";
    expect(normalizeMediaDetail(fixture, "ANIME").listEntry).toBeUndefined();
  });

  it("omits the list entry entirely when absent", () => {
    const fixture = clone(mediaDetailFixture) as any;
    delete fixture.mediaListEntry;
    expect(normalizeMediaDetail(fixture, "ANIME").listEntry).toBeUndefined();
  });

  it("returns an empty fuzzy date when the year is missing", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.startDate = { year: null, month: null, day: null };
    expect(normalizeMediaDetail(fixture, "ANIME").startDate).toBeUndefined();
  });

  it("drops relation/recommendation edges with a missing node", () => {
    const fixture = clone(mediaDetailFixture) as any;
    fixture.relations.edges.push({ relationType: "SEQUEL", node: null });
    fixture.recommendations.nodes.push({ mediaRecommendation: null });
    const detail = normalizeMediaDetail(fixture, "ANIME");
    expect(detail.relations).toHaveLength(1);
    expect(detail.recommendations).toHaveLength(1);
  });
});

describe("normalizeGroups / normalizeEntry (dashboard lists)", () => {
  it("normalizes anime list groups and entries", () => {
    const groups = normalizeGroups((dashboardFixture as any).anime, "ANIME");
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Watching");
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0]).toMatchObject({
      id: 1001,
      status: "CURRENT",
      score: 8.5,
      progress: 1122,
      media: expect.objectContaining({ id: 21, type: "ANIME" }),
    });
  });

  it("normalizes an empty manga list group", () => {
    const groups = normalizeGroups((dashboardFixture as any).manga, "MANGA");
    expect(groups).toEqual([{ name: "Reading", isCustomList: false, entries: [] }]);
  });

  it("throws on an unrecognized entry status", () => {
    const fixture = clone(dashboardFixture) as any;
    fixture.anime.lists[0].entries[0].status = "WATCHING_LATER";
    expect(() => normalizeGroups(fixture.anime, "ANIME")).toThrow(/unknown list status/);
  });

  it("throws when an entry's media type does not match the expected list type", () => {
    const fixture = clone(dashboardFixture) as any;
    fixture.anime.lists[0].entries[0].media.type = "MANGA";
    expect(() => normalizeGroups(fixture.anime, "ANIME")).toThrow(/mismatched media type/);
  });

  it("throws when list groups are malformed", () => {
    expect(() => normalizeGroups({ lists: "not-an-array" }, "ANIME")).toThrow(
      /invalid list groups/,
    );
  });
});
