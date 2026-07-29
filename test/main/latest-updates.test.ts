import { describe, expect, it } from "vitest";
import { normalizeAiringUpdates } from "../../src/main/anilist/normalize";
import { parseLatestMangaUpdates } from "../../src/main/mangadex";

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
});

describe("parseLatestMangaUpdates", () => {
  const manga = {
    id: "b73c9d2a-1111-2222-3333-444455556666",
    attributes: {
      title: { en: "Latest Manga" },
      links: { al: "30013" },
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
        title: "Latest Manga",
        coverUrl:
          "https://uploads.mangadex.org/covers/b73c9d2a-1111-2222-3333-444455556666/cover-abc.jpg.256.jpg",
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
});
