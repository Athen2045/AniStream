import { describe, expect, it } from "vitest";
import {
  MangaDexClient,
  findExactAniListMapping,
  findLatestNumericChapter,
  normalizeAtHomeNode,
  normalizeChapters,
  parseRateLimitCooldownMs,
} from "../../src/main/mangadex";

describe("MangaDex normalization", () => {
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
            relationships: [{ type: "scanlation_group", attributes: { name: "Sample Group" } }],
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

  it("reports an unavailable external chapter instead of leaking a raw at-home 404", async () => {
    const client = new MangaDexClient(
      "en",
      (async () => new Response("", { status: 404 })) as typeof fetch,
    );

    await expect(client.getPage({ chapterId: "external-chapter", page: 0 })).rejects.toThrow(
      /external publisher site or is no longer available/,
    );
  });
});
