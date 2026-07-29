import { describe, expect, it, vi } from "vitest";
import {
  AniwatchApiClient,
  parseEpisodePayload,
  parseSearchPayload,
  parseServerPayload,
  parseSourcePayload,
} from "../../src/main/aniwatch";
import type { StreamUrlBroker } from "../../src/main/hls-proxy";

const broker: StreamUrlBroker = {
  createUrl: (url) => `anistream-media://stream/${encodeURIComponent(url)}`,
};

describe("Aniwatch response normalization", () => {
  it("normalizes the documented title, episode, and server shapes", () => {
    expect(
      parseSearchPayload({
        searchYour: [{ name: "Your Name", jname: "Kimi no Na wa.", idanime: "your-name-10" }],
      }),
    ).toEqual([
      {
        id: "your-name-10",
        names: ["Your Name", "Kimi no Na wa."],
        displayName: "Your Name",
      },
    ]);
    expect(
      parseEpisodePayload({
        episodetown: [{ order: "1", name: "Episode one", epId: "your-name-10?ep=42" }],
      }),
    ).toEqual([{ id: "your-name-10?ep=42", number: 1, title: "Episode one" }]);
    expect(
      parseServerPayload({
        sub: [{ server: "megacloud", srcId: "123" }],
        dub: [{ server: "vidstreaming", srcId: "456" }],
      }),
    ).toEqual([
      { id: "123", name: "megacloud", audio: "sub" },
      { id: "456", name: "vidstreaming", audio: "dub" },
    ]);
  });

  it("normalizes both the README and current source payload variants", () => {
    const current = parseSourcePayload(
      {
        restres: {
          tracks: [
            {
              file: "https://cdn.example/subtitles.vtt",
              kind: "captions",
              label: "English",
            },
          ],
          sources: [{ url: "https://cdn.example/master.m3u8", type: "hls" }],
        },
      },
      { id: "123", name: "megacloud", audio: "sub" },
      broker,
    );
    const documented = parseSourcePayload(
      {
        serverSrc: [
          {
            serverlinkAni: "https://megacloud.example/embed/1",
            rest: [{ file: "https://video.example/master.m3u8", type: "hls" }],
          },
        ],
      },
      { id: "456", name: "megacloud", audio: "dub" },
      broker,
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.url).toContain("anistream-media://");
    expect(current[0]?.subtitles).toHaveLength(1);
    expect(documented).toHaveLength(1);
    expect(documented[0]?.language).toBe("dub");
  });

  it("returns empty values for malformed or unsafe provider data", () => {
    expect(parseSearchPayload({ searchYour: [{ name: "Bad", idanime: "../escape" }] })).toEqual([]);
    expect(parseEpisodePayload({ episodetown: [{ order: 0, epId: "bad" }] })).toEqual([]);
    expect(parseServerPayload({ sub: "not-an-array" })).toEqual([]);
    expect(
      parseSourcePayload(
        { restres: { sources: [{ url: "http://insecure.test/a.m3u8", type: "hls" }] } },
        { id: "1", name: "host", audio: "sub" },
        broker,
      ),
    ).toEqual([]);
  });
});

describe("Aniwatch client", () => {
  it("resolves an exact title into a normalized episode catalog", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/search/")) {
        return jsonResponse({
          searchYour: [{ name: "Blue Box", jname: "Ao no Hako", idanime: "blue-box-1" }],
        });
      }
      return jsonResponse({
        episodetown: [
          { order: "1", name: "Chinatsu Senpai", epId: "blue-box-1?ep=100" },
          { order: "2", name: "You Have to Go to the Nationals", epId: "blue-box-1?ep=101" },
        ],
      });
    });
    const client = new AniwatchApiClient(broker, fetcher as typeof fetch, "https://api.test");
    const result = await client.getEpisodeCatalog({
      aniListId: 170942,
      titles: ["Blue Box", "Ao no Hako"],
    });
    expect(result.status).toBe("available");
    expect(result.seasons[0]?.episodes).toHaveLength(2);
  });

  it("does not guess when search has no exact unique result", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        searchYour: [
          { name: "Blue Box Special", idanime: "blue-box-special-1" },
          { name: "Blue Box Recap", idanime: "blue-box-recap-1" },
        ],
      }),
    );
    const client = new AniwatchApiClient(broker, fetcher as typeof fetch, "https://api.test");
    const result = await client.getEpisodeCatalog({
      aniListId: 170942,
      titles: ["Blue Box"],
    });
    expect(result.status).toBe("unavailable");
    expect(result.seasons).toEqual([]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
