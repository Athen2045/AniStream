import { describe, expect, it } from "vitest";
import type { MangaDexReaderChapter, MangaReadingResume } from "../../src/shared/contracts";
import {
  buildLogicalChapterSequence,
  selectAdjacentChapter,
  selectChapterToRead,
} from "../../src/shared/chapter-selection";

const releases: MangaDexReaderChapter[] = [
  {
    id: "chapter-1-group-b",
    number: 1,
    volume: "1",
    translatedLanguage: "en",
    groups: [{ id: "group-b", name: "Group B" }],
    publishedAt: "2026-01-02T00:00:00Z",
    pages: 20,
  },
  {
    id: "chapter-1-group-a",
    number: 1,
    volume: "1",
    translatedLanguage: "en",
    groups: [{ id: "group-a", name: "Group A" }],
    publishedAt: "2026-01-01T00:00:00Z",
    pages: 20,
  },
  {
    id: "chapter-2-group-a",
    number: 2,
    volume: "1",
    translatedLanguage: "en",
    groups: [{ id: "group-a", name: "Group A" }],
    publishedAt: "2026-01-03T00:00:00Z",
    pages: 22,
  },
];

describe("logical MangaDex chapter selection", () => {
  it("does not restart from chapter one when tracker progress is caught up", () => {
    expect(selectChapterToRead(releases, 2)).toBeUndefined();
  });

  it("advances past a completed release that is no longer in the selected language", () => {
    expect(
      selectChapterToRead(releases, 0, {
        aniListId: 10,
        chapterId: "removed-release",
        chapterNumber: 1,
        progress: 1,
        updatedAt: "2026-01-03T00:00:00Z",
      })?.number,
    ).toBe(2);
  });

  it("chooses one release per volume and chapter using the preferred exact group ID", () => {
    expect(buildLogicalChapterSequence(releases, "group-a").map((chapter) => chapter.id)).toEqual([
      "chapter-1-group-a",
      "chapter-2-group-a",
    ]);
  });

  it("moves to the next logical chapter rather than another release of the current chapter", () => {
    expect(selectAdjacentChapter(releases, "chapter-1-group-b", 1, "group-a")?.id).toBe(
      "chapter-2-group-a",
    );
  });

  it("orders chapter numbers that restart inside later volumes by volume first", () => {
    const volumeChapters: MangaDexReaderChapter[] = [
      { ...releases[0], id: "volume-2-chapter-1", volume: "2" },
      { ...releases[0], id: "volume-1-chapter-2", number: 2, volume: "1" },
      { ...releases[0], id: "volume-1-chapter-1", volume: "1" },
    ];
    expect(buildLogicalChapterSequence(volumeChapters).map((chapter) => chapter.id)).toEqual([
      "volume-1-chapter-1",
      "volume-1-chapter-2",
      "volume-2-chapter-1",
    ]);
  });

  it("resumes the exact release and advances by logical chapter only after completion", () => {
    const resume: MangaReadingResume = {
      aniListId: 10,
      chapterId: "chapter-1-group-b",
      chapterNumber: 1,
      progress: 0.42,
      updatedAt: "2026-01-02T00:00:00Z",
    };
    expect(selectChapterToRead(releases, 0, resume, "group-a")?.id).toBe("chapter-1-group-b");
    expect(selectChapterToRead(releases, 0, { ...resume, progress: 0.95 }, "group-a")?.id).toBe(
      "chapter-2-group-a",
    );
  });

  it("does not wrap a completed final chapter back to the beginning", () => {
    expect(
      selectChapterToRead(
        releases,
        0,
        {
          aniListId: 10,
          chapterId: "chapter-2-group-a",
          chapterNumber: 2,
          progress: 0.95,
          updatedAt: "2026-01-03T00:00:00Z",
        },
        "group-a",
      ),
    ).toBeUndefined();
  });
});
