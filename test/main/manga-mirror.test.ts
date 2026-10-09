import { describe, expect, it, vi } from "vitest";
import type { MangaDexReaderChapter, MangaDexReaderSession } from "../../src/shared/contracts";
import {
  MangaMirrorClient,
  mergeMirrorChapters,
  parseMirrorChapterList,
  parseMirrorPageImages,
  safeImageUrl,
  type MirrorChapter,
} from "../../src/main/manga-mirror";
import { parseMalSyncMapping, pickMalSyncPage } from "../../src/main/malsync";
import { MangaTitleModule } from "../../src/main/manga-title";
import {
  parseProviderConfig,
  type MangaChapterMirrorProvider,
} from "../../src/main/provider-config";
import { ipcArgValidators } from "../../src/main/ipc-validation";

const CHAPTER_ROW = (id: string, label: string, time = "2026-09-26T03:16:36.809Z"): string => `
<div class="flex items-center" x-data="{ new_chapter: checkNewChapter('${time}') }">
    <a href="/chapters/${id}" class="hover:bg-base-300 flex-1 flex items-center p-2">
        <span class="me-2">
            <img src="/static/images/chapter-badge.svg" alt="" width="16" height="16">
        </span>
        <span class="grow flex items-center gap-2">
            <span class="">${label}</span>
            <span class="flex gap-1 items-center link-info" x-show="last_read_chapter === '${id}'">
                <span class="hidden md:inline">Last Read</span>
            </span>
        </span>
        <time class="text-datetime opacity-50" datetime="${time}">${time}</time>
    </a>
</div>`;

const PAGE_IMG = (n: number, host = "scans.images.example"): string => `
	<img
		src="https://${host}/manga/Sample/0002-${String(n).padStart(3, "0")}.png"
		class="max-w-full h-auto mx-auto"
		alt="Page ${n}"
		loading="lazy" />`;

const config: MangaChapterMirrorProvider = {
  id: "chapter-mirror",
  kind: "chapter-mirror",
  label: "Mirror",
  mappingSite: "MirrorSite",
  chapterListUrl: "https://mirror.example/series/{seriesId}/full-chapter-list",
  chapterPagesUrl: "https://mirror.example/chapters/{chapterId}/images?style=long",
};

const ULID = (n: number): string => `01M3DVDYA933SQQ6703XQYM${String(n).padStart(3, "0")}`;

describe("chapter mirror parsing", () => {
  it("reads chapter ids, numbers and dates and skips unnumbered or duplicate rows", () => {
    const html =
      CHAPTER_ROW(ULID(3), "Chapter 3") +
      CHAPTER_ROW(ULID(2), "Chapter 2.5") +
      CHAPTER_ROW(ULID(2), "Chapter 2.5") +
      CHAPTER_ROW(ULID(9), "Announcement") +
      CHAPTER_ROW(ULID(1), "Chapter 1 &amp; Prologue", "not-a-date");
    expect(parseMirrorChapterList(html)).toEqual([
      { id: ULID(3), number: 3, label: "Chapter 3", publishedAt: "2026-09-26T03:16:36.809Z" },
      { id: ULID(2), number: 2.5, label: "Chapter 2.5", publishedAt: "2026-09-26T03:16:36.809Z" },
      { id: ULID(1), number: 1, label: "Chapter 1 & Prologue", publishedAt: undefined },
    ]);
    expect(parseMirrorChapterList("<html>nothing</html>")).toEqual([]);
    // A series hosted as a German scan must not fill an English session.
    expect(parseMirrorChapterList(CHAPTER_ROW(ULID(5), "Kapitel 5"))).toEqual([]);
  });

  it("reads a series' own chapter names and prefers standard releases over variants", () => {
    const html =
      CHAPTER_ROW(ULID(10), "Mag Version 240") +
      CHAPTER_ROW(ULID(11), "Mag Version 239") +
      CHAPTER_ROW(ULID(12), "Punch 239") +
      CHAPTER_ROW(ULID(13), "Official Scans 196") +
      CHAPTER_ROW(ULID(14), "ReDraw 12") +
      CHAPTER_ROW(ULID(15), "Volume 3") +
      CHAPTER_ROW(ULID(16), "Side Story 2") +
      CHAPTER_ROW(ULID(17), "Webcomic 140") +
      CHAPTER_ROW(ULID(18), "Last Read");
    expect(parseMirrorChapterList(html).map((chapter) => [chapter.label, chapter.number])).toEqual([
      ["Punch 239", 239],
      ["Official Scans 196", 196],
      ["Mag Version 240", 240],
      ["Mag Version 239", 239],
      ["ReDraw 12", 12],
    ]);
  });

  it("keeps page images in order and drops unsafe or unlisted hosts", () => {
    const html =
      PAGE_IMG(1) +
      PAGE_IMG(2) +
      `<img src="/static/images/brand.png" alt="logo">` +
      `<img src="http://scans.images.example/x.png" alt="Page 3">` +
      `<img src="https://127.0.0.1/x.png" alt="Page 4">` +
      PAGE_IMG(5, "elsewhere.example");
    expect(parseMirrorPageImages(html)).toEqual([
      "https://scans.images.example/manga/Sample/0002-001.png",
      "https://scans.images.example/manga/Sample/0002-002.png",
      "https://elsewhere.example/manga/Sample/0002-005.png",
    ]);
    expect(parseMirrorPageImages(html, ["images.example"])).toHaveLength(2);
  });

  it("accepts only credential-free https URLs on public host names", () => {
    expect(safeImageUrl("https://cdn.images.example/a.png")).toBe(
      "https://cdn.images.example/a.png",
    );
    for (const bad of [
      "http://cdn.images.example/a.png",
      "https://user:pw@cdn.images.example/a.png",
      "https://10.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://localhost/a.png",
      "https://nas.local/a.png",
      "https://cdn.images.example:8443/a.png",
      "not a url",
    ])
      expect(safeImageUrl(bad)).toBeUndefined();
  });
});

describe("MAL-Sync mapping", () => {
  const payload = {
    title: "ONE PIECE",
    Sites: {
      MirrorSite: {
        a: { identifier: "01aaaa", aniId: 30013, title: "One Piece", url: "https://m.example/a" },
        b: {
          identifier: "01bbbb",
          aniId: 30013,
          title: "One Piece (Color)",
          url: "https://m.example/b",
        },
        c: { identifier: "01cccc", aniId: 99, title: "Other", url: "https://m.example/c" },
        d: { identifier: "../bad", aniId: 30013, title: "One Piece", url: "" },
      },
    },
  };

  it("keeps only exact AniList-ID entries and breaks ties by MAL-Sync's own title", () => {
    const mapping = parseMalSyncMapping(payload, 30013, "MirrorSite");
    expect(mapping.pages.map((page) => page.identifier)).toEqual(["01aaaa", "01bbbb"]);
    expect(pickMalSyncPage(mapping)?.identifier).toBe("01aaaa");
  });

  it("gives no series when exact-ID entries stay ambiguous or the site is missing", () => {
    expect(
      pickMalSyncPage({
        title: "Sample",
        pages: [
          { identifier: "x", title: "Sample Part 1", url: "" },
          { identifier: "y", title: "Sample Part 2", url: "" },
        ],
      }),
    ).toBeUndefined();
    expect(parseMalSyncMapping(payload, 30013, "Unknown").pages).toEqual([]);
    expect(parseMalSyncMapping("nope", 30013, "MirrorSite").pages).toEqual([]);
  });
});

describe("merging mirror chapters", () => {
  const hosted = (number: number): MangaDexReaderChapter => ({
    id: `md-${number}`,
    number,
    translatedLanguage: "en",
    groups: [{ id: "g", name: "Group" }],
    pages: 10,
  });
  const reader = (patch: Partial<MangaDexReaderSession> = {}): MangaDexReaderSession => ({
    status: "available",
    aniListId: 1,
    translatedLanguage: "en",
    availableLanguages: ["en"],
    availableGroups: [],
    archiveStatus: "complete",
    chapters: [hosted(2)],
    ...patch,
  });
  const mirror: MirrorChapter[] = [1, 2, 3, 3].map((number) => ({
    id: ULID(number),
    number,
    label: `Chapter ${number}`,
  }));

  it("adds only numbers MangaDex lacks, in order, marked with the mirror label", () => {
    const merged = mergeMirrorChapters({ aniListId: 1, reader: reader(), mirror, label: "Mirror" });
    expect(
      merged?.chapters.map((chapter) => [chapter.number, chapter.source ?? "mangadex"]),
    ).toEqual([
      [1, "mirror"],
      [2, "mangadex"],
      [3, "mirror"],
    ]);
    expect(merged?.chapters[0]).toMatchObject({ pages: 0, sourceLabel: "Mirror", groups: [] });
  });

  it("links MangaDex chapters to the mirror copy of the same number as a fallback", () => {
    const merged = mergeMirrorChapters({ aniListId: 1, reader: reader(), mirror, label: "Mirror" });
    const mangaDexChapter = merged?.chapters.find((chapter) => !chapter.source);
    expect(mangaDexChapter?.mirrorFallback).toEqual({ id: ULID(2), sourceLabel: "Mirror" });
    // Even with nothing to add, a fallback link alone still updates the session.
    const onlyFallback = mergeMirrorChapters({
      aniListId: 1,
      reader: reader(),
      mirror: [{ id: ULID(2), number: 2, label: "Chapter 2" }],
      label: "Mirror",
    });
    expect(onlyFallback?.chapters).toHaveLength(1);
    expect(onlyFallback?.chapters[0]?.mirrorFallback?.id).toBe(ULID(2));
  });

  it("makes an unmapped or failed title readable and leaves other languages alone", () => {
    const unmapped = mergeMirrorChapters({
      aniListId: 1,
      reader: reader({ status: "unmapped", chapters: [] }),
      mirror,
      label: "Mirror",
    });
    expect(unmapped).toMatchObject({ status: "available", message: undefined });
    expect(unmapped?.chapters).toHaveLength(3);
    const failed = mergeMirrorChapters({
      aniListId: 1,
      reader: reader({ status: "unavailable", chapters: [] }),
      mirror,
      label: "Mirror",
    });
    expect(failed?.message).toMatch(/only Mirror chapters/);
    const japanese = reader({ translatedLanguage: "ja", chapters: [] });
    expect(mergeMirrorChapters({ aniListId: 1, reader: japanese, mirror, label: "Mirror" })).toBe(
      japanese,
    );
  });

  it("clears the empty-language message once mirror chapters fill the list", () => {
    const empty = reader({
      chapters: [],
      message: "No readable chapters are currently available.",
    });
    expect(
      mergeMirrorChapters({ aniListId: 1, reader: empty, mirror, label: "Mirror" })?.message,
    ).toBeUndefined();
  });
});

describe("chapter mirror client", () => {
  const mapping = {
    getSitePages: vi.fn().mockResolvedValue({
      title: "Sample",
      pages: [{ identifier: "01abcdefgh", title: "Sample", url: "" }],
    }),
  };

  it("uses truthful headers, no Referer, and serves pages in-app", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      if (url.includes("/full-chapter-list"))
        return new Response(CHAPTER_ROW(ULID(7), "Chapter 7"), {
          headers: { "content-type": "text/html" },
        });
      if (url.includes("/images")) return new Response(PAGE_IMG(1) + PAGE_IMG(2));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    };
    const client = new MangaMirrorClient(config, { mapping, fetcher: fetcher as typeof fetch });

    const chapters = await client.getChapters(30013);
    expect(chapters).toEqual([expect.objectContaining({ id: ULID(7), number: 7 })]);
    expect(await client.getChapterInfo(ULID(7))).toEqual({ chapterId: ULID(7), pageCount: 2 });
    const page = await client.getPage({ chapterId: ULID(7), page: 1 });
    expect(page).toMatchObject({ page: 1, pageCount: 2, mimeType: "image/png" });

    expect(requests.map((request) => request.url)).toEqual([
      "https://mirror.example/series/01ABCDEFGH/full-chapter-list",
      `https://mirror.example/chapters/${ULID(7)}/images?style=long`,
      "https://scans.images.example/manga/Sample/0002-002.png",
    ]);
    for (const { headers } of requests) {
      expect(headers["user-agent"]).toBe("AniStream (personal desktop app)");
      expect(headers.referer).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(Object.keys(headers).some((name) => name.startsWith("hx-"))).toBe(false);
    }
  });

  it("stops on 403 and rejects non-image responses", async () => {
    let calls = 0;
    const refused = new MangaMirrorClient(config, {
      mapping,
      fetcher: (async () => {
        calls += 1;
        return new Response("blocked", { status: 403 });
      }) as typeof fetch,
    });
    await expect(refused.getChapters(30013)).rejects.toThrow(/refused/);
    // The queue is paused, so a second call does not reach the site.
    const second = refused.getChapters(30013).catch((error: Error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    void second;

    const notImage = new MangaMirrorClient(config, {
      mapping,
      fetcher: (async (input: string | URL | Request) =>
        String(input).includes("/images")
          ? new Response(PAGE_IMG(1))
          : new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch,
    });
    await expect(notImage.getPage({ chapterId: ULID(1), page: 0 })).rejects.toThrow(/image/);
  });
});

describe("chapter mirror wiring", () => {
  it("is merged into the title snapshot, and a mirror failure never hides MangaDex", async () => {
    const mangaDex = {
      getReader: vi.fn().mockResolvedValue({
        status: "available",
        aniListId: 1,
        translatedLanguage: "en",
        availableLanguages: ["en"],
        availableGroups: [],
        archiveStatus: "complete",
        chapters: [{ id: "md-1", number: 1, translatedLanguage: "en", groups: [], pages: 5 }],
      } satisfies MangaDexReaderSession),
    };
    const working = new MangaTitleModule({
      mangaDex,
      mirror: {
        label: "Mirror",
        getChapters: vi.fn().mockResolvedValue([{ id: ULID(2), number: 2, label: "Chapter 2" }]),
      },
    });
    const merged = await working.load({ aniListId: 1, title: "Sample" });
    expect(merged.reader?.chapters.map((chapter) => chapter.number)).toEqual([1, 2]);

    const broken = new MangaTitleModule({
      mangaDex,
      mirror: { label: "Mirror", getChapters: vi.fn().mockRejectedValue(new Error("down")) },
    });
    const snapshot = await broken.load({ aniListId: 1, title: "Sample" });
    expect(snapshot.reader?.chapters).toHaveLength(1);
    expect(snapshot.issues).toEqual([{ source: "chapter-mirror", message: "down" }]);

    const japanese = vi.fn();
    await new MangaTitleModule({
      mangaDex,
      mirror: { label: "Mirror", getChapters: japanese },
    }).load({ aniListId: 1, title: "Sample", translatedLanguage: "ja" });
    expect(japanese).not.toHaveBeenCalled();
  });

  it("parses the chapter-mirror config entry and validates mirror IPC input", () => {
    const parsed = parseProviderConfig({
      version: 2,
      manga: {
        media: [
          { id: "mangadex", kind: "mangadex" },
          { ...config, imageHosts: ["images.example"] },
        ],
      },
    });
    expect(parsed.manga.media[1]).toMatchObject({
      kind: "chapter-mirror",
      label: "Mirror",
      imageHosts: ["images.example"],
    });
    // Chapter list and page list must share one origin; a bad entry is dropped, not used.
    const mismatched = parseProviderConfig({
      version: 2,
      manga: {
        media: [
          { id: "mangadex", kind: "mangadex" },
          { ...config, chapterPagesUrl: "https://elsewhere.example/chapters/{chapterId}/images" },
        ],
      },
    });
    expect(mismatched.manga.media.map((entry) => entry.kind)).toEqual(["mangadex"]);
    expect(ipcArgValidators["manga:mirror-page"]([{ chapterId: ULID(1), page: 3 }])).toEqual([
      { chapterId: ULID(1), page: 3 },
    ]);
    expect(() => ipcArgValidators["manga:mirror-page"]([{ chapterId: "../x", page: 0 }])).toThrow();
    expect(() => ipcArgValidators["manga:mirror-chapter"]([{ chapterId: "" }])).toThrow();
    expect(ipcArgValidators["mangadex:chapter-readable"]([{ chapterId: "abc-123" }])).toEqual([
      { chapterId: "abc-123" },
    ]);
    expect(() => ipcArgValidators["mangadex:chapter-readable"]([{ chapterId: "a/b" }])).toThrow();
  });
});
