import { describe, expect, it, vi } from "vitest";
import type {
  MangaDexReaderChapter,
  MangaDexReaderSession,
  MangaEnrichment,
  MangaExternalChapter,
} from "../../src/shared/contracts";
import {
  buildMangaChapterFallback,
  missingChapterRanges,
} from "../../src/main/manga-chapter-fallback";
import { normalizeChapters, normalizeExternalChapters } from "../../src/main/mangadex";
import { parseMangaBakaEnrichment } from "../../src/main/mangabaka";
import { MangaTitleModule } from "../../src/main/manga-title";

const hosted = (number: number): MangaDexReaderChapter => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  number,
  translatedLanguage: "en",
  groups: [],
  pages: 20,
});
const external = (number: number, language = "en"): MangaExternalChapter => ({
  id: `10000000-0000-4000-8000-${String(number).padStart(12, "0")}-${language}`,
  number,
  url: `https://publisher.example/viewer/${number}`,
  site: "publisher.example",
  translatedLanguage: language,
});
const reader = (patch: Partial<MangaDexReaderSession> = {}): MangaDexReaderSession => ({
  status: "available",
  aniListId: 30_013,
  translatedLanguage: "en",
  availableLanguages: ["en"],
  availableGroups: [],
  archiveStatus: "complete",
  chapters: [],
  externalChapters: [],
  ...patch,
});
const enrichment = (patch: Partial<MangaEnrichment> = {}): MangaEnrichment => ({
  status: "available",
  aniListId: 30_013,
  authors: [],
  artists: [],
  publishers: [],
  checkedAt: "2026-10-03T00:00:00.000Z",
  totalChapters: 12,
  readingLinks: [
    { site: "Publisher Plus", url: "https://publisher.example/titles/1", language: "en" },
    { site: "Publisher Plus", url: "https://publisher.example/titles/2", language: "fr" },
    { site: "Shop", url: "https://shop.example/op", language: "es-la" },
  ],
  ...patch,
});

describe("manga chapter fallback", () => {
  it("collapses uncovered chapters into ranges", () => {
    expect(missingChapterRanges(new Set([1, 2, 5, 9]), 10)).toEqual([
      { from: 3, to: 4 },
      { from: 6, to: 8 },
      { from: 10, to: 10 },
    ]);
    expect(missingChapterRanges(new Set(), 3)).toEqual([{ from: 1, to: 3 }]);
    expect(missingChapterRanges(new Set([1, 2]), 2)).toEqual([]);
  });

  it("adds publisher chapters and missing ranges around in-app chapters", () => {
    const fallback = buildMangaChapterFallback({
      reader: reader({
        chapters: [hosted(1), hosted(2)],
        // Ch. 2 is readable in-app, so its publisher entry is dropped; fr is another language.
        externalChapters: [external(2), external(3), external(4), external(4), external(5, "fr")],
      }),
      enrichment: enrichment(),
      defaultLanguage: "en",
    });
    expect(fallback?.externalChapters.map((chapter) => chapter.number)).toEqual([3, 4]);
    // The provider's display name replaces the bare host for a matching reading link.
    expect(fallback?.externalChapters[0]?.site).toBe("Publisher Plus");
    expect(fallback?.missingRanges).toEqual([{ from: 5, to: 12 }]);
    expect(fallback?.readingLinks.map((link) => link.url)).toEqual([
      "https://publisher.example/titles/1",
    ]);
    expect(fallback?.totalChapters).toBe(12);
  });

  it("covers the whole run for an unmapped title and matches language subtags", () => {
    const fallback = buildMangaChapterFallback({
      reader: reader({ status: "unmapped", translatedLanguage: "es" }),
      enrichment: enrichment({ totalChapters: 3 }),
      defaultLanguage: "en",
    });
    expect(fallback?.missingRanges).toEqual([{ from: 1, to: 3 }]);
    expect(fallback?.readingLinks.map((link) => link.site)).toEqual(["Shop"]);
  });

  it("skips gaps with no official site in the chosen language and lists each site once", () => {
    const untranslated = buildMangaChapterFallback({
      // Like a series whose translation trails the original: the extra chapters exist only in ja.
      reader: reader({ chapters: [hosted(1), hosted(2)] }),
      enrichment: enrichment({
        totalChapters: 5,
        readingLinks: [{ site: "JP Reader", url: "https://jp.example/t/1", language: "ja" }],
      }),
      defaultLanguage: "en",
    });
    expect(untranslated).toBeUndefined();
    const fallback = buildMangaChapterFallback({
      reader: reader({ chapters: [hosted(1)] }),
      enrichment: enrichment({
        totalChapters: 2,
        readingLinks: [
          { site: "VIZ", url: "https://viz.example/chapters", language: "en" },
          { site: "VIZ", url: "https://viz.example/series", language: "en" },
          { site: "Plus", url: "https://plus.example/t", language: "en" },
        ],
      }),
      defaultLanguage: "en",
    });
    expect(fallback?.readingLinks.map((link) => link.url)).toEqual([
      "https://viz.example/chapters",
      "https://plus.example/t",
    ]);
  });

  it("adds nothing when everything is readable, the total is unknown, or the archive is partial", () => {
    const complete = reader({ chapters: [hosted(1), hosted(2)] });
    expect(
      buildMangaChapterFallback({
        reader: complete,
        enrichment: enrichment({ totalChapters: 2 }),
        defaultLanguage: "en",
      }),
    ).toBeUndefined();
    expect(
      buildMangaChapterFallback({
        reader: complete,
        enrichment: enrichment({ totalChapters: undefined }),
        defaultLanguage: "en",
      }),
    ).toBeUndefined();
    expect(
      buildMangaChapterFallback({
        reader: reader({ archiveStatus: "partial", chapters: [hosted(1)] }),
        enrichment: enrichment(),
        defaultLanguage: "en",
      }),
    ).toBeUndefined();
    expect(
      buildMangaChapterFallback({
        reader: complete,
        enrichment: enrichment({ status: "unavailable", totalChapters: 99 }),
        defaultLanguage: "en",
      }),
    ).toBeUndefined();
    expect(
      buildMangaChapterFallback({
        reader: complete,
        enrichment: enrichment({ totalChapters: 9_999_999 }),
        defaultLanguage: "en",
      }),
    ).toBeUndefined();
  });

  it("keeps MangaDex publisher entries apart from readable chapters", () => {
    const payload = {
      data: [
        {
          id: "a1c7c817-4e59-43b7-9365-09675a149a6f",
          attributes: {
            chapter: "1",
            translatedLanguage: "en",
            externalUrl: "https://www.publisher.example/viewer/1000000",
            pages: 0,
            publishAt: "2026-01-01T00:00:00+00:00",
          },
        },
        {
          id: "b1c7c817-4e59-43b7-9365-09675a149a6f",
          attributes: { chapter: "2", translatedLanguage: "en", externalUrl: "http://x.example/2" },
        },
        {
          id: "c1c7c817-4e59-43b7-9365-09675a149a6f",
          attributes: { chapter: "3", translatedLanguage: "en", pages: 18 },
        },
      ],
    };
    expect(normalizeExternalChapters(payload)).toEqual([
      {
        id: "a1c7c817-4e59-43b7-9365-09675a149a6f",
        number: 1,
        title: undefined,
        url: "https://www.publisher.example/viewer/1000000",
        site: "publisher.example",
        translatedLanguage: "en",
        publishedAt: "2026-01-01T00:00:00+00:00",
      },
    ]);
    expect(normalizeChapters(payload).map((chapter) => chapter.number)).toEqual([3]);
    expect(normalizeExternalChapters({ data: "nope" })).toEqual([]);
  });

  it("reads only official https reading links from MangaBaka", () => {
    const result = parseMangaBakaEnrichment(
      {
        data: {
          series: [
            {
              id: 377,
              state: "active",
              total_chapters: "1194",
              source: { anilist: { id: 30013 } },
              links_v2: [
                {
                  url: "https://publisher.example/t/1",
                  name_display: "Plus",
                  type: "webplatform",
                  language: "en",
                },
                {
                  url: "https://publisher.example/t/1",
                  name_display: "Plus",
                  type: "webplatform",
                  language: "en",
                },
                {
                  url: "https://shop.example/op",
                  name_display: "Shop",
                  type: "retailer",
                  language: "en",
                },
                {
                  url: "https://bad.example/op",
                  name_display: "Bad",
                  type: "piracy",
                  language: "en",
                },
                {
                  url: "https://x.example/op",
                  name_display: "X",
                  type: "social",
                  language: "unknown",
                },
                {
                  url: "http://plain.example/op",
                  name_display: "Plain",
                  type: "webplatform",
                  language: "en",
                },
                {
                  url: "https://pub.example/op",
                  name: "pub.example",
                  type: "publisher",
                  language: "EN; drop",
                },
              ],
            },
          ],
        },
      },
      30013,
    );
    expect(result.totalChapters).toBe(1194);
    expect(result.readingLinks).toEqual([
      { site: "Plus", url: "https://publisher.example/t/1", language: "en" },
      { site: "pub.example", url: "https://pub.example/op", language: "unknown" },
    ]);
  });

  it("is attached to the title snapshot only when the fallback is enabled", async () => {
    const deps = {
      mangaBaka: { getEnrichment: vi.fn().mockResolvedValue(enrichment({ totalChapters: 3 })) },
      mangaDex: { getReader: vi.fn().mockResolvedValue(reader({ chapters: [hosted(1)] })) },
    };
    const input = { aniListId: 30_013, title: "One Piece" };
    const enabled = await new MangaTitleModule({ ...deps, chapterFallback: true }).load(input);
    expect(enabled.chapterFallback?.missingRanges).toEqual([{ from: 2, to: 3 }]);
    expect(enabled.reader?.chapters).toHaveLength(1);
    const disabled = await new MangaTitleModule(deps).load(input);
    expect(disabled.chapterFallback).toBeUndefined();
  });
});
