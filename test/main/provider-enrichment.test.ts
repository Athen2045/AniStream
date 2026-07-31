import { describe, expect, it, vi } from "vitest";
import { MangaBakaClient, parseMangaBakaEnrichment } from "../../src/main/mangabaka";

describe("MangaBaka exact AniList enrichment", () => {
  it("accepts one exact active AniList source match", () => {
    const result = parseMangaBakaEnrichment(
      {
        data: {
          series: [
            {
              id: 84926,
              state: "active",
              title: "One Piece",
              authors: [{ name: "Oda Eiichirou" }],
              artists: ["Oda Eiichirou"],
              publishers: [{ name: "Shueisha" }],
              total_chapters: 1189,
              source: {
                anilist: { id: 30013, rating: 9.1 },
                manga_updates: { id: "abc123", rating: 8.85 },
              },
            },
          ],
        },
      },
      30013,
    );
    expect(result.status).toBe("available");
    expect(result.authors).toEqual(["Oda Eiichirou"]);
    expect(result.mangaUpdatesId).toBe("abc123");
    expect(result.mangaUpdatesRating).toBe(8.85);
  });

  it("rejects ambiguous exact mappings", () => {
    const item = {
      id: 1,
      state: "active",
      source: { anilist: { id: 30013 } },
    };
    const result = parseMangaBakaEnrichment(
      { data: { series: [item, { ...item, id: 2 }] } },
      30013,
    );
    expect(result.status).toBe("unavailable");
  });

  it("deduplicates concurrent enrichment without sharing a consumed Response body", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({
          data: {
            series: [
              {
                id: 84926,
                state: "active",
                title: "One Piece",
                source: { anilist: { id: 30013 } },
              },
            ],
          },
        }),
      ),
    );
    const client = new MangaBakaClient(fetcher as typeof fetch, undefined);

    const [first, second] = await Promise.all([
      client.getEnrichment(30013),
      client.getEnrichment(30013),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.status).toBe("available");
  });
});
