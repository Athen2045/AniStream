import { describe, expect, it } from "vitest";
import { KitsuClient } from "../../src/main/kitsu";
import {
  parseKitsuAnimeMapping,
  parseKitsuEpisodeArt,
  planKitsuEpisodePages,
} from "../../src/main/kitsu-episode-art";

const mapping = (externalId: string, animeId: string) => ({
  type: "mappings",
  id: `m-${animeId}`,
  attributes: { externalSite: "anilist/anime", externalId },
  relationships: { item: { data: { type: "anime", id: animeId } } },
});

const episode = (number: number, thumbnail: unknown) => ({
  type: "episodes",
  id: `e-${number}`,
  attributes: { number, thumbnail },
});

const thumb = (n: number) => ({
  large: `https://media.kitsu.app/episode/${n}/thumbnail/large.jpeg`,
  original: `https://media.kitsu.app/episode/${n}/thumbnail/original.jpg`,
});

describe("parseKitsuAnimeMapping", () => {
  it("accepts one exact AniList mapping", () => {
    expect(parseKitsuAnimeMapping({ data: [mapping("182255", "49240")] }, 182255)).toBe(49240);
  });

  it("rejects other IDs, other sites, ambiguity, and malformed payloads", () => {
    expect(parseKitsuAnimeMapping({ data: [mapping("1", "49240")] }, 182255)).toBeUndefined();
    const manga = mapping("182255", "49240");
    manga.attributes.externalSite = "anilist/manga";
    expect(parseKitsuAnimeMapping({ data: [manga] }, 182255)).toBeUndefined();
    expect(
      parseKitsuAnimeMapping({ data: [mapping("21", "12"), mapping("21", "13")] }, 21),
    ).toBeUndefined();
    expect(parseKitsuAnimeMapping({ data: [mapping("21", "12"), mapping("21", "12")] }, 21)).toBe(
      12,
    );
    expect(parseKitsuAnimeMapping({ data: "nope" }, 21)).toBeUndefined();
    expect(parseKitsuAnimeMapping(null, 21)).toBeUndefined();
  });
});

describe("planKitsuEpisodePages", () => {
  it("covers a short entry in one page", () => {
    expect(planKitsuEpisodePages(12, 1)).toEqual([0]);
  });

  it("loads the pages nearest the focus within the budget", () => {
    expect(planKitsuEpisodePages(1100, 1015)).toEqual([1000, 980, 1020, 960, 1040, 940]);
    expect(planKitsuEpisodePages(0, 1)).toEqual([]);
  });
});

describe("parseKitsuEpisodeArt", () => {
  it("keeps Kitsu-hosted thumbnails for valid episode numbers", () => {
    const payload = {
      data: [
        episode(1, thumb(1)),
        episode(2, null),
        episode(3, { large: "https://evil.example/x.jpg" }),
        episode(4, { medium: "http://media.kitsu.app/insecure.jpg" }),
        episode(5, { medium: "https://media.kitsu.app/episode/5/medium.jpeg" }),
        episode(1.5, thumb(6)),
        episode(99, thumb(99)),
        { type: "anime", attributes: { number: 7, thumbnail: thumb(7) } },
      ],
    };
    expect(parseKitsuEpisodeArt(payload, 12)).toEqual([
      { number: 1, stillUrl: "https://media.kitsu.app/episode/1/thumbnail/large.jpeg" },
      { number: 5, stillUrl: "https://media.kitsu.app/episode/5/medium.jpeg" },
    ]);
  });

  it("returns nothing for malformed payloads", () => {
    expect(parseKitsuEpisodeArt({ data: {} }, 12)).toEqual([]);
    expect(parseKitsuEpisodeArt("<html>", 12)).toEqual([]);
  });
});

function fakeKitsu(routes: (url: URL) => Response): { client: KitsuClient; urls: URL[] } {
  const urls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    urls.push(url);
    return routes(url);
  }) as typeof fetch;
  return { client: new KitsuClient("https://kitsu.example/api/edge", fetcher), urls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("KitsuClient.getEpisodeArt", () => {
  it("maps the AniList ID exactly, then reads episode thumbnails", async () => {
    const { client, urls } = fakeKitsu((url) =>
      url.pathname.endsWith("/mappings")
        ? json({ data: [mapping("182255", "49240")] })
        : json({ data: [episode(1, thumb(1)), episode(2, thumb(2))] }),
    );
    const result = await client.getEpisodeArt({ aniListId: 182255, episodes: 2, focus: 1 });
    expect(result).toEqual({
      complete: true,
      art: [
        { number: 1, stillUrl: "https://media.kitsu.app/episode/1/thumbnail/large.jpeg" },
        { number: 2, stillUrl: "https://media.kitsu.app/episode/2/thumbnail/large.jpeg" },
      ],
    });
    expect(urls[0].searchParams.get("filter[externalId]")).toBe("182255");
    // Without `include=item` Kitsu omits the mapped anime's ID (live finding 2026-10-13).
    expect(urls[0].searchParams.get("include")).toBe("item");
    expect(urls[1].pathname).toBe("/api/edge/anime/49240/episodes");
    expect(urls[1].searchParams.get("page[offset]")).toBe("0");

    // Cached: a second lookup makes no requests.
    await client.getEpisodeArt({ aniListId: 182255, episodes: 2, focus: 1 });
    expect(urls).toHaveLength(2);
  });

  it("returns no art, and caches the miss, when no exact mapping exists", async () => {
    const { client, urls } = fakeKitsu(() => json({ data: [] }));
    expect(await client.getEpisodeArt({ aniListId: 5, episodes: 12, focus: 1 })).toEqual({
      art: [],
      complete: true,
    });
    await client.getEpisodeArt({ aniListId: 5, episodes: 12, focus: 1 });
    expect(urls).toHaveLength(1);
  });

  it("marks the result partial when an episode page fails", async () => {
    const { client } = fakeKitsu((url) =>
      url.pathname.endsWith("/mappings")
        ? json({ data: [mapping("21", "12")] })
        : url.searchParams.get("page[offset]") === "0"
          ? json({ data: [episode(1, thumb(1))] })
          : json({ errors: [] }, 500),
    );
    const result = await client.getEpisodeArt({ aniListId: 21, episodes: 40, focus: 1 });
    expect(result.complete).toBe(false);
    expect(result.art.map((row) => row.number)).toEqual([1]);
  });

  it("stops on 429 instead of retrying", async () => {
    const { client, urls } = fakeKitsu(() => json({ errors: [] }, 429));
    await expect(client.getEpisodeArt({ aniListId: 21, episodes: 12, focus: 1 })).rejects.toThrow(
      /429/,
    );
    expect(urls).toHaveLength(1);
  });
});
