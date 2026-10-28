import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChapterDownloadManager,
  chapterFolder,
  type ChapterPageSource,
} from "../../src/main/downloads/chapter-download-manager";
import { createChapterDownloadStore } from "../../src/main/downloads/chapter-download-store";
import { DownloadManager } from "../../src/main/downloads/download-manager";
import { createDownloadStore } from "../../src/main/downloads/download-store";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import type { MangaDexReaderPage } from "../../src/shared/contracts";
import {
  CHAPTER_ESTIMATE_BYTES,
  parseChapterRequests,
  type DownloadChapterRequest,
} from "../../src/shared/downloads";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class Refused extends Error {}

function page(chapterId: string, index: number, count: number, size = 100): MangaDexReaderPage {
  const bytes = new Uint8Array(size).fill(index + 1);
  return {
    chapterId,
    page: index,
    pageCount: count,
    mimeType: index % 2 ? "image/png" : "image/jpeg",
    imageBytes: bytes.buffer,
  };
}

function request(
  chapterId: string,
  number?: number,
  source: "mangadex" | "mirror" = "mangadex",
): DownloadChapterRequest {
  return {
    aniListId: 30013,
    title: "One: Piece?",
    chapter: {
      source,
      id: chapterId,
      ...(number !== undefined ? { number } : {}),
      translatedLanguage: "en",
      groups: [{ id: "g1", name: "Group One" }],
    },
  };
}

function setup(options: {
  pages?: (chapterId: string, index: number) => Promise<MangaDexReaderPage>;
  limitBytes?: number;
  mirror?: Partial<ChapterPageSource>;
}) {
  const root = mkdtempSync(path.join(tmpdir(), "anistream-chapters-"));
  roots.push(root);
  const store = createChapterDownloadStore(new Database(":memory:"));
  const pages = vi.fn(options.pages ?? (async (id: string, index: number) => page(id, index, 3)));
  const manager = new ChapterDownloadManager({
    store,
    settings: () => ({
      folder: root,
      limitBytes: options.limitBytes ?? 1024 ** 3,
      quality: "1080p",
    }),
    otherBytes: () => ({ held: 0, committed: 0 }),
    sources: {
      mangadex: {
        label: "MangaDex",
        page: pages,
        isRefusal: (error) => error instanceof Refused,
        pageDelayMs: 0,
      },
      mirror: {
        label: "Mirror",
        page: pages,
        isRefusal: (error) => error instanceof Refused,
        pageDelayMs: 0,
        ...options.mirror,
      },
    },
    onChange: () => undefined,
  });
  return { root, store, manager, pages };
}

describe("chapter downloads", () => {
  it("saves every page as served, then a manifest, and reads them back offline", async () => {
    const { manager, store, pages } = setup({});
    expect(manager.add([request("ch-1", 12.5)])).toEqual({ added: 1, skipped: 0, overLimit: 0 });
    await vi.waitFor(() => expect(manager.list()[0]?.status).toBe("done"));

    const item = store.list()[0]!;
    expect(item).toMatchObject({ pagesDone: 3, pagesTotal: 3, bytesDone: 300, bytesExpected: 300 });
    expect(path.basename(item.folder)).toBe("Chapter 0012.5 (d-ch-1)");
    expect(path.basename(path.dirname(item.folder))).toBe("One Piece (30013)");
    expect(readdirSync(item.folder).sort()).toEqual([
      "001.jpg",
      "002.png",
      "003.jpg",
      "chapter.json",
    ]);
    const manifest = JSON.parse(readFileSync(path.join(item.folder, "chapter.json"), "utf8"));
    expect(manifest.chapter.groups).toEqual([{ id: "g1", name: "Group One" }]);
    expect(pages).toHaveBeenCalledTimes(3);

    const second = await manager.offlinePage({ id: item.id, page: 1 });
    expect(second).toMatchObject({
      chapterId: "ch-1",
      page: 1,
      pageCount: 3,
      mimeType: "image/png",
    });
    expect(new Uint8Array(second.imageBytes)[0]).toBe(2);
  });

  it("skips chapters already queued and stays within the storage limit", async () => {
    const { manager } = setup({ limitBytes: CHAPTER_ESTIMATE_BYTES * 2 });
    const result = manager.add([request("a"), request("a"), request("b"), request("c")]);
    expect(result).toEqual({ added: 2, skipped: 1, overLimit: 1 });
    expect(manager.add([request("a")]).skipped).toBe(1);
  });

  it("stops on a refusal and pauses the rest of that source's queue", async () => {
    const { manager, store } = setup({
      pages: async (id, index) => {
        if (id === "m-1") throw new Refused("403");
        return page(id, index, 2);
      },
    });
    manager.add([request("m-1", 1, "mirror"), request("m-2", 2, "mirror"), request("d-1", 3)]);
    await vi.waitFor(() =>
      expect(store.list().map((item) => item.status)).toEqual(["failed", "paused", "done"]),
    );
    const [failed, paused] = store.list();
    expect(failed!.error).toMatch(/Mirror refused the download/);
    expect(paused!.error).toMatch(/Paused because Mirror refused/);
  });

  it("resumes a partial chapter from the pages already on disk", async () => {
    let fail = true;
    const { manager, store, pages } = setup({
      pages: async (id, index) => {
        if (index === 2 && fail) throw new Error("connection reset");
        return page(id, index, 4);
      },
    });
    manager.add([request("r-1", 1)]);
    await vi.waitFor(() => expect(store.list()[0]?.status).toBe("failed"), { timeout: 15_000 });
    expect(store.list()[0]).toMatchObject({ pagesDone: 2, pagesTotal: 4 });
    fail = false;
    pages.mockClear();
    await manager.apply("retry", store.list()[0]!.id);
    await vi.waitFor(() => expect(store.list()[0]?.status).toBe("done"));
    // Pages 1 and 2 came from disk; only 3 and 4 were fetched again.
    expect(pages.mock.calls.map(([, index]) => index)).toEqual([2, 3]);
  }, 20_000);

  it("removes only its own chapter folder, and the title folder once empty", async () => {
    const { manager, store } = setup({});
    manager.add([request("x-1", 1)]);
    await vi.waitFor(() => expect(store.list()[0]?.status).toBe("done"));
    const { folder, id } = store.list()[0]!;
    await manager.apply("remove", id);
    expect(existsSync(folder)).toBe(false);
    expect(existsSync(path.dirname(folder))).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("marks a chapter failed when its files were deleted outside AniStream", async () => {
    const { manager, store } = setup({});
    manager.add([request("gone", 1)]);
    await vi.waitFor(() => expect(store.list()[0]?.status).toBe("done"));
    const { folder, id } = store.list()[0]!;
    rmSync(folder, { recursive: true, force: true });
    await expect(manager.offlinePage({ id, page: 0 })).rejects.toThrow(/missing/);
    expect(store.get(id)?.status).toBe("failed");
  });

  it("names folders by number and source, keeping group releases apart", () => {
    expect(path.basename(chapterFolder("/r", request("abcdef123456", 7)))).toBe(
      "Chapter 0007 (d-abcdef12)",
    );
    expect(path.basename(chapterFolder("/r", request("q", undefined, "mirror")))).toBe(
      "Chapter x (m-q)",
    );
  });
});

describe("chapter download requests from the renderer", () => {
  it("accepts well-formed chapters and rejects malformed ones", () => {
    expect(parseChapterRequests([request("ch-1", 3)])).toEqual([request("ch-1", 3)]);
    expect(parseChapterRequests([])).toBeUndefined();
    expect(parseChapterRequests([{ ...request("x"), aniListId: 0 }])).toBeUndefined();
    expect(
      parseChapterRequests([{ ...request("x"), chapter: { ...request("x").chapter, id: "../x" } }]),
    ).toBeUndefined();
    expect(
      parseChapterRequests([
        { ...request("x"), chapter: { ...request("x").chapter, source: "other" } },
      ]),
    ).toBeUndefined();
    expect(() => ipcArgValidators["downloads:add-chapters"]([[{ bad: true }]])).toThrow();
    expect(ipcArgValidators["downloads:chapter-page"]([{ id: "abc-1", page: 2 }])).toEqual([
      { id: "abc-1", page: 2 },
    ]);
    expect(() => ipcArgValidators["downloads:chapter-page"]([{ id: "abc", page: -1 }])).toThrow();
  });
});

describe("shared storage with anime downloads", () => {
  it("counts manga chapters in the anime limit and the state", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anistream-shared-"));
    roots.push(root);
    const db = new Database(":memory:");
    db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const store = createDownloadStore(db);
    store.saveSettings({ folder: root, limitBytes: 1024 ** 3, quality: "720p" });
    const manager = new DownloadManager({
      store,
      defaultFolder: root,
      resolve: () => Promise.reject(new Error("not used")),
      onChange: () => undefined,
      manga: () => ({ chapters: [], held: 900 * 1024 ** 2, committed: 1000 * 1024 ** 2 }),
    });
    const result = await manager.add([{ aniListId: 1, episode: 1, title: "Show" }]);
    expect(result.added).toBe(0);
    expect(result.message).toMatch(/do(es)? not fit/);
    expect(result.state.usedBytes).toBe(900 * 1024 ** 2);
    expect(result.state.chapters).toEqual([]);
    manager.dispose();
  });
});
