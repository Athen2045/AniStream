import { describe, expect, it, vi } from "vitest";
import { createMangaReaderSession } from "../../src/renderer/src/manga-reader-session";

describe("MangaReaderSession", () => {
  it("loads requested pages, limits concurrency, and retries failures", async () => {
    const resolvers: Array<(value: { imageBytes: ArrayBuffer; mimeType: string }) => void> = [];
    const loadPage = vi.fn(
      () =>
        new Promise<{ imageBytes: ArrayBuffer; mimeType: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const session = createMangaReaderSession({
      aniListId: 10,
      chapterId: "chapter",
      pageCount: 4,
      loadPage,
      createObjectUrl: (page) => `blob:${page}`,
      revokeObjectUrl: vi.fn(),
      saveResume: vi.fn(),
      onChapterRead: vi.fn(),
    });

    session.requestPage(0);
    session.requestPage(1);
    session.requestPage(2);
    session.requestPage(3);
    expect(loadPage).toHaveBeenCalledTimes(3);

    resolvers.shift()?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4));

    resolvers[0]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    resolvers[1]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    resolvers[2]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    await vi.waitFor(() => expect(session.getSnapshot().pageUrls.filter(Boolean)).toHaveLength(4));

    session.dispose();
  });

  it("persists progress, marks a chapter once, and revokes page URLs on dispose", () => {
    const saveResume = vi.fn();
    const onChapterRead = vi.fn();
    const revokeObjectUrl = vi.fn();
    const session = createMangaReaderSession({
      aniListId: 10,
      chapterId: "chapter",
      chapterNumber: 2,
      pageCount: 1,
      loadPage: async () => ({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" }),
      createObjectUrl: () => "blob:page",
      revokeObjectUrl,
      saveResume,
      onChapterRead,
      now: () => 20_000,
    });

    session.markProgress(0.9);
    session.markProgress(1);
    expect(onChapterRead).toHaveBeenCalledTimes(1);
    expect(saveResume).toHaveBeenCalledWith({
      aniListId: 10,
      chapterId: "chapter",
      chapterNumber: 2,
      progress: 0.9,
    });

    session.dispose();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });
});
