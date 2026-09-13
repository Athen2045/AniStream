import { describe, expect, it, vi } from "vitest";
import { MangaTitleModule } from "../../src/main/manga-title";

describe("MangaTitleModule", () => {
  it("returns a complete title snapshot while preserving series data when groups fail", async () => {
    const module = new MangaTitleModule({
      mangaBaka: {
        getEnrichment: vi.fn().mockResolvedValue({
          status: "available",
          aniListId: 30_013,
          authors: ["Eiichiro Oda"],
          artists: ["Eiichiro Oda"],
          publishers: ["Shueisha"],
          mangaUpdatesId: "13",
          checkedAt: "2026-08-02T00:00:00.000Z",
        }),
      },
      mangaUpdates: {
        getSeries: vi.fn().mockResolvedValue({
          status: "available",
          seriesId: 13,
          title: "One Piece",
          latestChapter: 1189,
          groups: [],
          checkedAt: "2026-08-02T00:00:00.000Z",
        }),
        getGroups: vi.fn().mockRejectedValue(new Error("groups unavailable")),
      },
      mangaDex: {
        getReader: async (input) => ({
          status: "available" as const,
          aniListId: 30_013,
          mangaDexId: "one-piece",
          translatedLanguage: input.translatedLanguage ?? "en",
          availableLanguages: ["en", "es"],
          availableGroups: [],
          preferredGroupId: input.preferredGroupId,
          archiveStatus: "complete" as const,
          chapters: [],
        }),
      },
      preferences: {
        getMangaReaderPreferences: vi.fn().mockReturnValue({
          aniListId: 30_013,
          translatedLanguage: "es",
          preferredGroupId: "group-a",
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      },
      resume: {
        getMangaReadingResume: vi.fn().mockReturnValue({
          aniListId: 30_013,
          chapterId: "chapter-1188",
          chapterNumber: 1188,
          progress: 0.42,
          updatedAt: "2026-08-02T00:00:00.000Z",
        }),
      },
    });

    const snapshot = await module.load({ aniListId: 30_013, title: "One Piece" });

    expect(snapshot.enrichment?.mangaUpdates).toMatchObject({
      status: "available",
      seriesId: 13,
      latestChapter: 1189,
      groups: [],
    });
    expect(snapshot.reader).toMatchObject({
      status: "available",
      translatedLanguage: "es",
      preferredGroupId: "group-a",
    });
    expect(snapshot.preferences).toMatchObject({
      translatedLanguage: "es",
      preferredGroupId: "group-a",
    });
    expect(snapshot.resume?.progress).toBe(0.42);
    expect(snapshot.issues).toEqual([
      { source: "mangaupdates-groups", message: "groups unavailable" },
    ]);
  });
});
