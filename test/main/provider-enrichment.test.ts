import { describe, expect, it } from "vitest";
import { rewriteHlsManifest } from "../../src/main/hls-manifest";
import { parseMangaBakaEnrichment } from "../../src/main/mangabaka";
import { parseZenshinCatalog } from "../../src/main/zenshin-episodes";

describe("Zenshin episode enrichment", () => {
  it("groups regular episodes by season and ignores specials", () => {
    const result = parseZenshinCatalog(
      {
        mainTitle: "Ao no Hako",
        title: { en: "Blue Box" },
        episodes: {
          "1": {
            episode: "1",
            type: "Regular Episode",
            seasonNumber: 1,
            episodeNumber: 1,
            runtime: 24,
            overview: "Episode summary",
            image: "https://art.example/1.jpg",
            title: { en: "Chinatsu Senpai" },
          },
          OP1: { type: "Opening Song", episode: "OP1" },
        },
      },
      170942,
    );
    expect(result.status).toBe("available");
    expect(result.provider).toBe("zenshin");
    expect(result.seasons[0]?.episodes[0]).toMatchObject({
      number: 1,
      title: "Chinatsu Senpai",
      description: "Episode summary",
      durationMinutes: 24,
    });
  });
});

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
});

describe("HLS manifest proxy rewrite", () => {
  it("rewrites relative playlists, segments, keys, and maps", () => {
    const rewritten = rewriteHlsManifest(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
        '#EXT-X-MAP:URI="/init.mp4"',
        "segments/one.ts",
      ].join("\n"),
      "https://cdn.example/show/master.m3u8",
      (url) => `proxy:${url}`,
    );
    expect(rewritten).toContain('URI="proxy:https://cdn.example/show/keys/key.bin"');
    expect(rewritten).toContain('URI="proxy:https://cdn.example/init.mp4"');
    expect(rewritten).toContain("proxy:https://cdn.example/show/segments/one.ts");
  });

  it("rejects non-HTTPS manifests", () => {
    expect(() => rewriteHlsManifest("#EXTM3U", "http://cdn.example/master.m3u8", String)).toThrow(
      "Only HTTPS",
    );
  });
});
