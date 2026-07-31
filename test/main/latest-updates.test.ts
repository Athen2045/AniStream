import { describe, expect, it } from "vitest";
import {
  normalizeAiringUpdates,
  normalizeAiringUpdatesPage,
} from "../../src/main/anilist/normalize";
import {
  findLatestChapterIds,
  mergeLatestChapterDetails,
  parseLatestMangaUpdates,
  parseMangaDexPageInfo,
} from "../../src/main/mangadex";
import { classifyLatestMangaUpdates, parseAniListMangaKindHints } from "../../src/main/manga-kind";
import { parseMalMangaPublicationKind } from "../../src/main/mal";

function airingMedia(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "ANIME",
    title: { userPreferred: `Anime ${id}` },
    coverImage: { large: `https://s4.anilist.co/cover/${id}.jpg` },
    siteUrl: `https://anilist.co/anime/${id}`,
    genres: ["Action"],
    isAdult: false,
    ...overrides,
  };
}

describe("normalizeAiringUpdates", () => {
  it("normalizes aired schedules into one row per anime", () => {
    const updates = normalizeAiringUpdates(
      {
        airingSchedules: [
          { episode: 12, airingAt: 1_900_000_000, media: airingMedia(1) },
          { episode: 11, airingAt: 1_899_000_000, media: airingMedia(1) },
          { episode: 3, airingAt: 1_898_000_000, media: airingMedia(2) },
        ],
      },
      20,
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ episode: 12, airedAt: 1_900_000_000 });
    expect(updates[0].media.id).toBe(1);
    expect(updates[1].media.id).toBe(2);
  });

  it("keeps adult titles (user direction 2026-07-29) while dropping malformed rows", () => {
    const updates = normalizeAiringUpdates(
      {
        airingSchedules: [
          { episode: 1, airingAt: 1, media: airingMedia(1, { isAdult: true }) },
          { episode: 2, airingAt: 2, media: { id: 3 } },
          "garbage",
          { episode: 4, airingAt: 4, media: airingMedia(4) },
        ],
      },
      20,
    );
    expect(updates).toHaveLength(2);
    expect(updates.map((update) => update.media.id)).toEqual([1, 4]);
  });

  it("caps the result at the requested limit", () => {
    const schedules = Array.from({ length: 30 }, (_, index) => ({
      episode: 1,
      airingAt: index + 1,
      media: airingMedia(index + 1),
    }));
    expect(normalizeAiringUpdates({ airingSchedules: schedules }, 20)).toHaveLength(20);
  });

  it("throws on a structurally invalid page", () => {
    expect(() => normalizeAiringUpdates({ airingSchedules: "nope" }, 20)).toThrow(
      /invalid airing schedules/,
    );
  });

  it("returns the independent latest-update page metadata", () => {
    const page = normalizeAiringUpdatesPage(
      {
        pageInfo: { currentPage: 2, perPage: 50, lastPage: 12, hasNextPage: true },
        airingSchedules: [{ episode: 2, airingAt: 20, media: airingMedia(2) }],
      },
      21,
    );
    expect(page.pageInfo).toEqual({
      currentPage: 2,
      perPage: 21,
      lastPage: 12,
      hasNextPage: true,
    });
    expect(page.items).toHaveLength(1);
  });
});

describe("parseLatestMangaUpdates", () => {
  const manga = {
    id: "b73c9d2a-1111-2222-3333-444455556666",
    attributes: {
      title: { en: "Latest Manga" },
      links: { al: "30013", mal: "13" },
      originalLanguage: "ja",
      latestUploadedChapter: "chapter-uuid",
      updatedAt: "2026-07-29T10:00:00+00:00",
    },
    relationships: [
      { type: "author", attributes: {} },
      { type: "cover_art", attributes: { fileName: "cover-abc.jpg" } },
    ],
  };

  it("parses a manga row with cover art and an exact AniList mapping", () => {
    const updates = parseLatestMangaUpdates({ data: [manga] });
    expect(updates).toEqual([
      {
        mangaDexId: "b73c9d2a-1111-2222-3333-444455556666",
        aniListId: 30013,
        malId: 13,
        title: "Latest Manga",
        coverUrl:
          "https://uploads.mangadex.org/covers/b73c9d2a-1111-2222-3333-444455556666/cover-abc.jpg.512.jpg",
        coverUrlFallback:
          "https://uploads.mangadex.org/covers/b73c9d2a-1111-2222-3333-444455556666/cover-abc.jpg",
        originalLanguage: "ja",
        publicationKind: "MANGA",
        updatedAt: "2026-07-29T10:00:00+00:00",
        mangaDexUrl: "https://mangadex.org/title/b73c9d2a-1111-2222-3333-444455556666",
      },
    ]);
  });

  it("keeps rows without an AniList link but omits the mapping", () => {
    const withoutLink = structuredClone(manga) as typeof manga & {
      attributes: { links?: unknown };
    };
    delete withoutLink.attributes.links;
    const updates = parseLatestMangaUpdates({ data: [withoutLink] });
    expect(updates).toHaveLength(1);
    expect(updates[0].aniListId).toBeUndefined();
  });

  it("falls back through en -> ja-ro -> any language for the title", () => {
    const localized = structuredClone(manga);
    localized.attributes.title = { "ja-ro": "Romaji Title" } as never;
    expect(parseLatestMangaUpdates({ data: [localized] })[0].title).toBe("Romaji Title");
  });

  it("drops rows missing required fields and rejects unsafe cover file names", () => {
    const noTitle = structuredClone(manga);
    noTitle.attributes.title = {} as never;
    const badCover = structuredClone(manga);
    badCover.relationships = [
      { type: "cover_art", attributes: { fileName: "../escape.jpg" } },
    ] as never;

    const updates = parseLatestMangaUpdates({ data: [noTitle, badCover, "garbage"] });
    expect(updates).toHaveLength(1);
    expect(updates[0].coverUrl).toBeUndefined();
  });

  it("returns an empty list for a malformed payload", () => {
    expect(parseLatestMangaUpdates(undefined)).toEqual([]);
    expect(parseLatestMangaUpdates({ data: "nope" })).toEqual([]);
  });

  it("parses pagination and merges the latest chapter's number and publish time", () => {
    const payload = { limit: 21, offset: 21, total: 60, data: [manga] };
    const items = parseLatestMangaUpdates(payload);
    const chapterIds = findLatestChapterIds(payload);
    const merged = mergeLatestChapterDetails(items, chapterIds, {
      data: [
        {
          id: "chapter-uuid",
          attributes: { chapter: "1189", publishAt: "2026-07-29T12:00:00+00:00" },
        },
      ],
    });
    expect(parseMangaDexPageInfo(payload, 2, 21)).toEqual({
      currentPage: 2,
      perPage: 21,
      lastPage: 3,
      hasNextPage: true,
    });
    expect(merged[0]).toMatchObject({
      chapter: "1189",
      updatedAt: "2026-07-29T12:00:00+00:00",
    });
  });
});

describe("manga publication-kind cross-reference", () => {
  it("uses AniList country as a cross-check and MAL as an exact-ID tiebreaker", () => {
    const hints = parseAniListMangaKindHints({
      media: [{ id: 30013, idMal: 13, countryOfOrigin: "KR", format: "MANGA" }],
    });
    expect(hints[0].publicationKind).toBe("MANHWA");
    expect(parseMalMangaPublicationKind({ media_type: "manhua" })).toBe("MANHUA");

    const item = parseLatestMangaUpdates({
      data: [
        {
          id: "manga-id",
          attributes: {
            title: { en: "Cross Referenced" },
            links: { al: "30013", mal: "13" },
            originalLanguage: "ja",
            updatedAt: "2026-07-29T10:00:00+00:00",
          },
          relationships: [],
        },
      ],
    })[0];
    const classified = classifyLatestMangaUpdates(
      [item],
      new Map(hints.map((hint) => [hint.aniListId, hint])),
      new Map([[13, "MANHUA"]]),
    );
    expect(classified[0].publicationKind).toBe("MANHUA");
  });
});
