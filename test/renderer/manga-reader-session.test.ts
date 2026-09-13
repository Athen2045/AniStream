import { describe, expect, it, vi } from "vitest";
import { createMangaReaderSession } from "../../src/renderer/src/manga-reader-session";

describe("MangaReaderSession", () => {
  it("releases an undecodable page and accepts a manual retry without accepting stale image errors", async () => {
    let serial = 0;
    const revokeObjectUrl = vi.fn();
    const loadPage = vi.fn(async () => ({
      imageBytes: new ArrayBuffer(4),
      mimeType: "image/jpeg",
    }));
    const session = createMangaReaderSession({
      aniListId: 10,
      chapterId: "chapter",
      pageCount: 1,
      loadPage,
      createObjectUrl: () => `blob:${++serial}`,
      revokeObjectUrl,
      saveResume: vi.fn(),
      onChapterRead: vi.fn(),
    });
    session.requestPage(0);
    await vi.waitFor(() => expect(session.getSnapshot().pageUrls[0]).toBe("blob:1"));
    session.markPageDecodeError(0, "blob:1");
    expect(session.getSnapshot().pageUrls[0]).toBeUndefined();
    expect(session.getSnapshot().pageErrors[0]).toContain("display");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:1");
    expect(loadPage).toHaveBeenCalledTimes(1);
    session.requestPage(0);
    await vi.waitFor(() => expect(session.getSnapshot().pageUrls[0]).toBe("blob:2"));
    session.markPageDecodeError(0, "blob:1");
    expect(session.getSnapshot().pageUrls[0]).toBe("blob:2");
    expect(session.getSnapshot().pageErrors[0]).toBeUndefined();
    session.dispose();
  });
  it("does not overwrite completed reading with late scroll or disposal checkpoints", async () => {
    const saved: number[] = [];
    const session = createMangaReaderSession({
      aniListId: 10,
      chapterId: "chapter",
      pageCount: 1,
      loadPage: async () => ({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" }),
      createObjectUrl: () => "blob:page",
      revokeObjectUrl: () => undefined,
      saveResume: (input) => {
        saved.push(input.progress);
      },
      onChapterRead: async () => undefined,
      now: () => 20_000,
    });
    session.markProgress(0.95);
    await Promise.resolve();
    session.markProgress(0.1);
    session.dispose();
    expect(saved).toEqual([0.95]);
  });
  it("surfaces completion persistence failure and allows explicit retry", async () => {
    let fail = true;
    let saved = false;
    const session = createMangaReaderSession({
      aniListId: 10,
      chapterId: "chapter",
      pageCount: 1,
      loadPage: async () => ({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" }),
      createObjectUrl: () => "blob:page",
      revokeObjectUrl: () => undefined,
      saveResume: () => undefined,
      onChapterRead: async () => {
        if (fail) throw new Error("disk full");
        saved = true;
      },
    });
    session.markProgress(0.95);
    await vi.waitFor(() => expect(session.getSnapshot().persistenceError).toContain("disk full"));
    fail = false;
    session.retryPersistence();
    await vi.waitFor(() => expect(saved).toBe(true));
    expect(session.getSnapshot().persistenceError).toBeUndefined();
    session.dispose();
  });
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
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3));

    resolvers.shift()?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    await vi.waitFor(() => expect(loadPage).toHaveBeenCalledTimes(4));

    resolvers[0]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    resolvers[1]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    resolvers[2]?.({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
    await vi.waitFor(() => expect(session.getSnapshot().pageUrls.filter(Boolean)).toHaveLength(4));

    session.dispose();
  });

  it.each([
    ["HTTP 429 rate limit", /busy.*few minutes/i],
    ["socket timeout", /taking longer.*moment/i],
    ["invalid response payload", /incomplete data.*shortly/i],
    ["internal upstream route 17", /Page 1 could not be loaded.*try again/i],
  ])(
    "gives page recovery guidance for %s without exposing internals",
    async (message, expected) => {
      const session = createMangaReaderSession({
        aniListId: 10,
        chapterId: "chapter",
        pageCount: 1,
        loadPage: async () => {
          throw new Error(message);
        },
        createObjectUrl: () => "blob:page",
        revokeObjectUrl: vi.fn(),
        saveResume: vi.fn(),
        onChapterRead: vi.fn(),
      });

      session.requestPage(0);
      await vi.waitFor(() => expect(session.getSnapshot().pageErrors[0]).toMatch(expected));
      expect(session.getSnapshot().pageErrors[0]).not.toContain("route 17");
      session.dispose();
    },
  );

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
