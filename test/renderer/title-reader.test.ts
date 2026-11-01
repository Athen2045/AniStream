import { describe, expect, it } from "vitest";
import type { MangaChapterDownload } from "../../src/shared/downloads";
import { downloadedChapterSession } from "../../src/renderer/src/useTitleReader";

const download = (
  id: string,
  number: number,
  overrides: Partial<MangaChapterDownload> = {},
): MangaChapterDownload => ({
  id: `d-${id}`,
  aniListId: 7,
  title: "Example Manga",
  chapter: {
    source: "mangadex",
    id,
    number,
    translatedLanguage: "en",
    groups: [{ id: "g", name: "Group" }],
  },
  status: "done",
  pagesDone: 20,
  pagesTotal: 20,
  bytesDone: 1,
  bytesExpected: 1,
  createdAt: "2026-10-29T00:00:00Z",
  updatedAt: "2026-10-29T00:00:00Z",
  ...overrides,
});

describe("downloaded chapter session", () => {
  it("lists only this title's finished downloads, in chapter order, with their credits", () => {
    const session = downloadedChapterSession(7, [
      download("b", 366),
      download("a", 365),
      download("c", 367, { status: "downloading" }),
      download("x", 1, { aniListId: 8 }),
    ]);
    expect(session?.chapters.map((chapter) => chapter.id)).toEqual(["a", "b"]);
    expect(session?.chapters[0]).toMatchObject({ pages: 20, groupName: "Group" });
    expect(session).toMatchObject({ status: "available", translatedLanguage: "en" });
  });

  it("keeps the mirror credit and gives no session without finished downloads", () => {
    const mirror = download("m", 2, {
      chapter: {
        source: "mirror",
        id: "m",
        number: 2,
        translatedLanguage: "en",
        groups: [],
        sourceLabel: "Mirror",
      },
    });
    expect(downloadedChapterSession(7, [mirror])?.chapters[0]).toMatchObject({
      source: "mirror",
      sourceLabel: "Mirror",
    });
    expect(downloadedChapterSession(7, [download("c", 3, { status: "failed" })])).toBeUndefined();
    expect(downloadedChapterSession(7, undefined)).toBeUndefined();
  });
});
