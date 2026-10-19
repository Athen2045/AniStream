import { describe, expect, it } from "vitest";
import { AniZipClient, parseAniZipEpisodeArt } from "../../src/main/anizip";

const image = (n: number) => `https://artworks.thetvdb.com/banners/v4/episode/${n}/screencap/x.jpg`;

const payload = (aniListId: number) => ({
  mappings: { anilist_id: aniListId, kitsu_id: 1 },
  episodes: {
    "2": { episode: "2", image: image(2) },
    "1": { episode: "1", image: image(1) },
    "3": { episode: "3", image: null },
    "4": { episode: "4", image: "https://evil.example/x.jpg" },
    "5": { episode: "5", image: "http://artworks.thetvdb.com/insecure.jpg" },
    S1: { episode: "S1", image: image(901) },
    "0": { episode: "0", image: image(900) },
  },
});

describe("parseAniZipEpisodeArt", () => {
  it("keeps numbered episodes with TheTVDB screencaps, in order", () => {
    expect(parseAniZipEpisodeArt(payload(21), 21)).toEqual([
      { number: 1, stillUrl: image(1) },
      { number: 2, stillUrl: image(2) },
    ]);
  });

  it("rejects a different AniList ID and malformed payloads", () => {
    expect(parseAniZipEpisodeArt(payload(22), 21)).toEqual([]);
    expect(parseAniZipEpisodeArt({ mappings: { anilist_id: "21" }, episodes: {} }, 21)).toEqual([]);
    expect(parseAniZipEpisodeArt({ episodes: [] }, 21)).toEqual([]);
    expect(parseAniZipEpisodeArt("<html>", 21)).toEqual([]);
  });
});

function fake(respond: () => Response): { client: AniZipClient; calls: URL[] } {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    calls.push(new URL(input instanceof Request ? input.url : input.toString()));
    return respond();
  }) as typeof fetch;
  return { client: new AniZipClient("https://anizip.example", fetcher), calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("AniZipClient.getEpisodeArt", () => {
  it("requests by AniList ID, trims to aired episodes, and caches", async () => {
    const { client, calls } = fake(() => json(payload(21)));
    expect(await client.getEpisodeArt(21, 1)).toEqual([{ number: 1, stillUrl: image(1) }]);
    expect(calls[0].searchParams.get("anilist_id")).toBe("21");
    expect(await client.getEpisodeArt(21, 2)).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it("treats 404 as no entry", async () => {
    const { client } = fake(() => json({ error: "not found" }, 404));
    expect(await client.getEpisodeArt(99, 12)).toEqual([]);
  });

  it("stops on 429 and surfaces server errors", async () => {
    await expect(fake(() => json({}, 429)).client.getEpisodeArt(21, 12)).rejects.toThrow(/429/);
    await expect(fake(() => json({}, 500)).client.getEpisodeArt(21, 12)).rejects.toThrow(/500/);
  });
});

describe("ani.zip episode titles and synopses", () => {
  it("prefers English, fixes AniDB backticks, and strips summary source lines", () => {
    const art = parseAniZipEpisodeArt(
      {
        mappings: { anilist_id: 21 },
        episodes: {
          "1": {
            title: { en: "I`m Luffy!", "x-jat": "Ore wa Luffy!" },
            overview: "",
            summary: "A boy in a barrel.\nSource: crunchyroll",
          },
          "2": { title: { en: "Episode 2", "x-jat": "Daini-wa" }, overview: "TheTVDB text." },
          "3": { title: { en: "Episode 3" } },
          "4": { title: { en: "x".repeat(400) }, overview: "y".repeat(2_000) },
        },
      },
      21,
    );
    expect(art[0]).toEqual({ number: 1, title: "I’m Luffy!", synopsis: "A boy in a barrel." });
    expect(art[1]).toEqual({ number: 2, title: "Daini-wa", synopsis: "TheTVDB text." });
    // A placeholder title with no image or synopsis adds nothing.
    expect(art.map((row) => row.number)).toEqual([1, 2, 4]);
    expect(art[2].title?.length).toBe(300);
    expect(art[2].synopsis?.endsWith("…")).toBe(true);
  });
});
