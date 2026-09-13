import { expect, it } from "vitest";
import { createMangaReaderSession } from "../../src/renderer/src/manga-reader-session";

it("can reactivate after strict effect cleanup without accepting an older load", async () => {
  const finishes: Array<(page: { imageBytes: ArrayBuffer; mimeType: string }) => void> = [];
  let created = 0;
  const session = createMangaReaderSession({
    aniListId: 1,
    chapterId: "fixture",
    pageCount: 1,
    loadPage: () =>
      new Promise((finish) => {
        finishes.push(finish);
      }),
    createObjectUrl: () => `blob:${++created}`,
    revokeObjectUrl: () => undefined,
    saveResume: () => undefined,
    onChapterRead: () => undefined,
  });
  session.requestPage(0);
  await Promise.resolve();
  session.dispose();
  session.activate();
  session.requestPage(0);
  await Promise.resolve();
  const page = { imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" };
  finishes[0](page);
  finishes[1](page);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(created).toBe(1);
  expect(session.getSnapshot().pageUrls[0]).toBe("blob:1");
  session.dispose();
});

it("protects oversized nearby pages and drops late offscreen responses", async () => {
  let resolve: (value: { imageBytes: ArrayBuffer; mimeType: string }) => void = () => undefined;
  const revoked: string[] = [];
  const session = createMangaReaderSession({
    aniListId: 1,
    chapterId: "fixture",
    pageCount: 2,
    loadPage: () =>
      new Promise((finish) => {
        resolve = finish;
      }),
    createObjectUrl: () => "blob:oversize",
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
    saveResume: () => undefined,
    onChapterRead: () => undefined,
  });
  session.setPageNear(0, true);
  session.requestPage(0);
  await Promise.resolve();
  resolve({ imageBytes: new ArrayBuffer(33 * 1024 * 1024), mimeType: "image/jpeg" });
  await new Promise<void>((finish) => setTimeout(finish, 0));
  expect(session.getSnapshot().pageUrls[0]).toBe("blob:oversize");
  session.setPageNear(0, false);
  expect(revoked).toEqual(["blob:oversize"]);
  session.setPageNear(1, true);
  session.requestPage(1);
  await Promise.resolve();
  session.setPageNear(1, false);
  resolve({ imageBytes: new ArrayBuffer(1), mimeType: "image/jpeg" });
  await new Promise<void>((finish) => setTimeout(finish, 0));
  expect(session.getSnapshot().pageUrls[1]).toBeUndefined();
  session.dispose();
});

it("bounds retained page bytes for a synthetic 120-page chapter and reloads evicted pages", async () => {
  const urls = new Map<string, number>();
  let serial = 0;
  let peak = 0;
  const session = createMangaReaderSession({
    aniListId: 1,
    chapterId: "retention-fixture",
    pageCount: 120,
    loadPage: async () => ({
      imageBytes: new ArrayBuffer(2 * 1024 * 1024),
      mimeType: "image/jpeg",
    }),
    createObjectUrl: (page) => {
      const url = `blob:fixture-${serial++}`;
      urls.set(url, page.imageBytes.byteLength);
      return url;
    },
    revokeObjectUrl: (url) => {
      urls.delete(url);
    },
    saveResume: () => undefined,
    onChapterRead: () => undefined,
  });
  for (let page = 0; page < 120; page++) {
    if (page > 0) session.setPageNear(page - 1, false);
    session.setPageNear(page, true);
    session.requestPage(page);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    peak = Math.max(
      peak,
      [...urls.values()].reduce((sum, bytes) => sum + bytes, 0),
    );
  }
  expect(urls.size).toBe(12);
  expect(peak).toBe(24 * 1024 * 1024);
  expect(session.getSnapshot().pageUrls[0]).toBeUndefined();
  session.setPageNear(119, false);
  session.setPageNear(0, true);
  session.requestPage(0);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(session.getSnapshot().pageUrls[0]).toBeTruthy();
  session.dispose();
  expect(urls.size).toBe(0);
});
