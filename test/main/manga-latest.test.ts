import { describe, expect, it, vi } from "vitest";
import type { LatestMangaUpdate } from "../../src/shared/contracts";
import { MangaLatestModule } from "../../src/main/manga-latest";

const item: LatestMangaUpdate = {
  mangaDexId: "md-1",
  aniListId: 101,
  malId: 202,
  title: "Exact mapped title",
  originalLanguage: "ja",
  publicationKind: "OTHER",
  updatedAt: "2026-08-10T00:00:00.000Z",
  mangaDexUrl: "https://mangadex.org/title/md-1",
};

describe("MangaLatestModule", () => {
  it("loads and classifies a page behind one degraded-mode interface", async () => {
    const getLatestUpdates = vi.fn(async () => ({
      pageInfo: { currentPage: 1, perPage: 21, lastPage: 1, hasNextPage: false },
      items: [item],
    }));
    const module = new MangaLatestModule({
      mangaDex: { getLatestUpdates },
      aniList: {
        getMangaKindHints: vi.fn(
          async () =>
            new Map([
              [
                101,
                {
                  aniListId: 101,
                  malId: 202,
                  countryOfOrigin: "KR",
                  publicationKind: "MANHWA",
                },
              ],
            ]),
        ),
      },
      mal: {
        configured: true,
        getMangaPublicationKind: vi.fn(async () => "MANHWA"),
      },
    });

    const result = await module.load(1);

    expect(getLatestUpdates).toHaveBeenCalledWith(1);
    expect(result.items[0]?.publicationKind).toBe("MANHWA");
  });

  it("keeps MangaDex results usable when enrichment providers fail", async () => {
    const module = new MangaLatestModule({
      mangaDex: {
        getLatestUpdates: vi.fn(async () => ({
          pageInfo: { currentPage: 1, perPage: 21, lastPage: 1, hasNextPage: false },
          items: [item],
        })),
      },
      aniList: {
        getMangaKindHints: vi.fn(async () => {
          throw new Error("AniList unavailable");
        }),
      },
      mal: {
        configured: true,
        getMangaPublicationKind: vi.fn(async () => {
          throw new Error("MAL unavailable");
        }),
      },
    });

    const result = await module.load(1);

    expect(result.items[0]?.publicationKind).toBe("MANGA");
  });
});
