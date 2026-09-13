import { describe, expect, it, vi } from "vitest";
import {
  MangaDexClient,
  findExactAniListMapping,
  findLatestNumericChapter,
  normalizeAtHomeNode,
  normalizeChapters,
  parseRateLimitCooldownMs,
} from "../../src/main/mangadex";

describe("MangaDex normalization", () => {
  it("lets a foreground title enter the shared gate before a whole availability batch", async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      let foregroundDelay: number | undefined;
      const client = new MangaDexClient("en", async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("title") === "Foreground") foregroundDelay = Date.now() - started;
        return Response.json({ data: [] });
      });
      const entries = Array.from({ length: 30 }, (_, index) => ({
        aniListId: index + 1,
        title: `Background ${index + 1}`,
      }));
      const availability = client.getAvailability(entries);
      const foreground = client.getReader({ aniListId: 100, title: "Foreground" });
      await vi.runAllTimersAsync();
      expect((await availability).map((item) => item.aniListId)).toEqual(
        entries.map((item) => item.aniListId),
      );
      expect((await foreground).status).toBe("unmapped");
      expect(foregroundDelay).toBeLessThanOrEqual(1001);
    } finally {
      vi.useRealTimers();
    }
  });
  it("maps only a result with the exact AniList external ID", () => {
    const payload = {
      data: [
        { id: "similar-title", attributes: { links: { al: "999" } } },
        { id: "exact-title", attributes: { links: { al: "118586" } } },
      ],
    };
    expect(findExactAniListMapping(payload, 118586)).toBe("exact-title");
    expect(findExactAniListMapping(payload, 123)).toBeUndefined();
  });

  it("rejects ambiguous duplicate AniList mappings", () => {
    expect(
      findExactAniListMapping(
        {
          data: [
            { id: "first", attributes: { links: { al: "118586" } } },
            { id: "second", attributes: { links: { al: "118586" } } },
          ],
        },
        118586,
      ),
    ).toBeUndefined();
  });

  it("finds the greatest numeric chapter across volumes", () => {
    const payload = {
      volumes: {
        "1": { chapters: { "1": {}, "2.5": {} } },
        "2": { chapters: { "10": {}, extra: {} } },
      },
    };
    expect(findLatestNumericChapter(payload)).toBe(10);
  });

  it("returns undefined when a language aggregate has no readable chapters", () => {
    expect(findLatestNumericChapter({ volumes: {} })).toBeUndefined();
  });

  it("honors MangaDex's UNIX reset timestamp before generic Retry-After", () => {
    const resetAt = Math.floor(Date.now() / 1_000) + 30;
    expect(parseRateLimitCooldownMs(String(resetAt), "120")).toBeGreaterThan(28_000);
  });

  it("normalizes only readable translated chapter records", () => {
    expect(
      normalizeChapters({
        data: [
          {
            id: "chapter-one",
            attributes: {
              chapter: "1",
              title: "Beginning",
              pages: 24,
              translatedLanguage: "en",
              publishAt: "2026-01-01T00:00:00+00:00",
            },
            relationships: [
              {
                id: "sample-group",
                type: "scanlation_group",
                attributes: { name: "Sample Group" },
              },
            ],
          },
          { id: "invalid", attributes: { pages: 0, translatedLanguage: "en" } },
          {
            id: "external-publisher-chapter",
            attributes: {
              chapter: "1183",
              pages: 1,
              translatedLanguage: "en",
              externalUrl: "https://mangaplus.shueisha.co.jp/",
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: "chapter-one",
        number: 1,
        title: "Beginning",
        pages: 24,
        translatedLanguage: "en",
        publishedAt: "2026-01-01T00:00:00+00:00",
        groupName: "Sample Group",
        groups: [{ id: "sample-group", name: "Sample Group" }],
      },
    ]);
  });

  it("does not expose externally hosted chapters to MangaDex@Home", () => {
    expect(
      normalizeChapters({
        data: [
          {
            id: "2dd494f6-1b7c-4498-9d54-b83405aca902",
            attributes: {
              chapter: "1183",
              title: "Good Morn-Maid",
              translatedLanguage: "en",
              externalUrl: "https://mangaplus.shueisha.co.jp/",
              pages: 1,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts only HTTPS MangaDex@Home nodes with complete image metadata", () => {
    expect(
      normalizeAtHomeNode({
        baseUrl: "https://uploads.mangadex.org",
        chapter: { hash: "safe_hash", data: ["1.jpg"], dataSaver: ["1.jpg"] },
      }),
    ).toEqual({
      baseUrl: "https://uploads.mangadex.org",
      hash: "safe_hash",
      data: ["1.jpg"],
      dataSaver: ["1.jpg"],
    });
    expect(() =>
      normalizeAtHomeNode({
        baseUrl: "http://not-https.example",
        chapter: { hash: "safe_hash", data: ["1.jpg"], dataSaver: ["1.jpg"] },
      }),
    ).toThrow(/non-HTTPS/);
  });

  it("refreshes an expired MangaDex@Home node once after an image 404", async () => {
    const responses = [
      Response.json({
        baseUrl: "https://old-node.example",
        chapter: { hash: "old_hash", data: ["1.jpg"], dataSaver: ["1.jpg"] },
      }),
      new Response("", { status: 404 }),
      Response.json({
        baseUrl: "https://fresh-node.example",
        chapter: { hash: "fresh_hash", data: ["1.jpg"], dataSaver: ["1.jpg"] },
      }),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ];
    const requestedUrls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected fetch.");
      return response;
    };
    const client = new MangaDexClient("en", fetcher as typeof fetch);

    const page = await client.getPage({ chapterId: "chapter-1", page: 0 });

    expect(page.mimeType).toBe("image/jpeg");
    expect(new Uint8Array(page.imageBytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(requestedUrls).toEqual([
      "https://api.mangadex.org/at-home/server/chapter-1",
      "https://old-node.example/data/old_hash/1.jpg",
      "https://api.mangadex.org/at-home/server/chapter-1",
      "https://fresh-node.example/data/fresh_hash/1.jpg",
    ]);
  });

  it("uses the selected quality filenames and keeps original/data-saver caches separate", async () => {
    const requested: string[] = [];
    const client = new MangaDexClient("en", (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/at-home/server/"))
        return Response.json({
          baseUrl: "https://uploads.mangadex.org",
          chapter: { hash: "hash", data: ["original.png"], dataSaver: ["small.jpg"] },
        });
      return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch);
    await client.getPage({ chapterId: "chapter-quality", page: 0, quality: "data-saver" });
    await client.getPage({ chapterId: "chapter-quality", page: 0, quality: "data" });
    await client.getPage({ chapterId: "chapter-quality", page: 0, quality: "data-saver" });
    expect(requested).toEqual([
      "https://api.mangadex.org/at-home/server/chapter-quality",
      "https://uploads.mangadex.org/data-saver/hash/small.jpg",
      "https://uploads.mangadex.org/data/hash/original.png",
    ]);
  });

  it("reports an unavailable external chapter instead of leaking a raw at-home 404", async () => {
    const client = new MangaDexClient(
      "en",
      (async () => new Response("", { status: 404 })) as typeof fetch,
    );

    await expect(client.getPage({ chapterId: "external-chapter", page: 0 })).rejects.toThrow(
      /external publisher site or is no longer available/,
    );
  });

  it("reports an empty chosen language without silently falling back across languages", async () => {
    const responses = [
      Response.json({
        data: [
          {
            id: "manga-1",
            attributes: {
              links: { al: "500" },
              status: "ongoing",
              availableTranslatedLanguages: ["en", "es"],
            },
          },
        ],
      }),
      Response.json({ data: [], total: 0 }),
    ];
    const requestedUrls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected fetch.");
      return response;
    };
    const client = new MangaDexClient("en", fetcher as typeof fetch);

    const session = await client.getReader({
      aniListId: 500,
      title: "Sample Manga",
      translatedLanguage: "en",
    });

    expect(session.status).toBe("available");
    expect(session.translatedLanguage).toBe("en");
    expect(session.availableLanguages).toEqual(["en", "es"]);
    expect(session.chapters).toEqual([]);
    expect(session.message).toMatch(/chosen language/i);
    expect(requestedUrls[1]).toContain("translatedLanguage%5B%5D=en");
    expect(requestedUrls).toHaveLength(2);
  });

  it("rejects off-language chapter rows from a chosen-language response", async () => {
    const responses = [
      Response.json({
        data: [
          {
            id: "manga-language-boundary",
            attributes: {
              links: { al: "501" },
              status: "ongoing",
              availableTranslatedLanguages: ["en", "es"],
            },
          },
        ],
      }),
      Response.json({
        data: [
          {
            id: "chapter-es",
            attributes: { chapter: "1", pages: 20, translatedLanguage: "es" },
            relationships: [],
          },
        ],
        total: 1,
      }),
    ];
    const client = new MangaDexClient(
      "en",
      (async () =>
        responses.shift() ?? new Response("unexpected", { status: 500 })) as typeof fetch,
    );

    const session = await client.getReader({ aniListId: 501, title: "Language Boundary" });

    expect(session.translatedLanguage).toBe("en");
    expect(session.chapters).toEqual([]);
  });

  it("filters aggregate availability to the chosen language", async () => {
    const responses = [
      Response.json({
        data: [{ id: "manga-2", attributes: { links: { al: "700" }, status: "ongoing" } }],
      }),
      Response.json({ volumes: { "1": { chapters: { "3": {} } } } }),
    ];
    const requestedUrls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected fetch.");
      return response;
    };
    const client = new MangaDexClient("en", fetcher as typeof fetch);

    const [availability] = await client.getAvailability([
      { aniListId: 700, title: "Another Manga" },
    ]);

    expect(availability).toMatchObject({ status: "available", latestChapter: 3 });
    expect(requestedUrls[1]).toContain("translatedLanguage%5B%5D=en");
  });

  it("preserves exact scanlation group IDs and names for release selection", () => {
    expect(
      normalizeChapters({
        data: [
          {
            id: "chapter-one",
            attributes: { chapter: "1", pages: 20, translatedLanguage: "en" },
            relationships: [
              { id: "group-a", type: "scanlation_group", attributes: { name: "Group A" } },
              { id: "group-b", type: "scanlation_group", attributes: { name: "Group B" } },
            ],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "chapter-one",
        groups: [
          { id: "group-a", name: "Group A" },
          { id: "group-b", name: "Group B" },
        ],
      }),
    ]);
  });

  it("keeps successful archive batches and reports an incomplete chapter archive", async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      attributes: {
        chapter: String(index + 1),
        pages: 20,
        translatedLanguage: "en",
      },
      relationships: [],
    }));
    let request = 0;
    const client = new MangaDexClient("en", (async () => {
      request += 1;
      if (request === 1) {
        return Response.json({
          data: [
            {
              id: "manga-archive",
              attributes: {
                links: { al: "900" },
                status: "ongoing",
                availableTranslatedLanguages: ["en"],
              },
            },
          ],
        });
      }
      if (request === 2) return Response.json({ data: firstBatch, total: 101 });
      throw new Error("later archive batch failed");
    }) as typeof fetch);

    const session = await client.getReader({ aniListId: 900, title: "Archive" });

    expect(session.chapters).toHaveLength(100);
    expect(session.archiveStatus).toBe("partial");
  });
});
