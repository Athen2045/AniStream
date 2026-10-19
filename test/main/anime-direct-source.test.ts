import { describe, expect, it } from "vitest";
import {
  matchDirectSeries,
  parseDirectEpisodes,
  parseDirectSearch,
  parseDirectStream,
  searchQueries,
  type DirectEpisode,
  type DirectSearchItem,
} from "../../src/main/anime-direct-source";
import { assToVtt } from "../../src/main/ass-to-vtt";
import { requireHttpsUrl, rewriteHlsManifest } from "../../src/main/hls-manifest";

/** Pages embed JSON in Alpine x-data with \u0022 quote escapes, as the source does. */
const alpine = (key: string, value: unknown): string =>
  `<div x-data="{ ${key}: JSON.parse('${JSON.stringify(value).replace(/"/g, "\\u0022")}'), more: 1 }"></div>`;

describe("direct source parsing", () => {
  it("reads search items", () => {
    const html = alpine("items", [
      {
        slug: "mdkytdqp",
        main_title: "Sousou no Frieren",
        title_list: { "1": "Frieren: Beyond Journey`s End" },
        type: "TV Series",
        start_year: 2023,
        episode_count: 28,
        is_ongoing: false,
      },
      { slug: "../bad" },
    ]);
    expect(parseDirectSearch(html)).toEqual([
      {
        slug: "mdkytdqp",
        titles: ["Sousou no Frieren", "Frieren: Beyond Journey`s End"],
        type: "TV Series",
        startYear: 2023,
        episodeCount: 28,
        ongoing: false,
      },
    ]);
    expect(parseDirectSearch("<html>")).toEqual([]);
  });

  it("reads episodes with titles, summaries and air dates", () => {
    const html = alpine("items", [
      {
        slug: "1",
        title_list: { "1": "The Journey`s End" },
        summary: "Start.",
        air_date: "2023-09-29 12:00",
        duration: 1440,
      },
      { slug: "x" },
    ]);
    expect(parseDirectEpisodes(html)).toEqual([
      {
        number: 1,
        title: "The Journey\u2019s End",
        summary: "Start.",
        airDate: "2023-09-29",
        durationSeconds: 1440,
      },
    ]);
  });

  it("reads the player's HTTPS stream and subtitle tracks only", () => {
    const html = `<div x-data="vidstackPlayer(JSON.parse('${JSON.stringify({
      src: "https://cdn.example/master.m3u8",
      subtitles: [
        {
          title: "English",
          language: "en",
          format: "ass",
          file: "https://cdn.example/en.ass",
          default: true,
        },
        { language: "de", file: "http://cdn.example/de.ass" },
      ],
    }).replace(/"/g, "\\u0022")}'))"></div>`;
    expect(parseDirectStream(html)).toEqual({
      src: "https://cdn.example/master.m3u8",
      subtitles: [
        {
          url: "https://cdn.example/en.ass",
          language: "en",
          label: "English",
          format: "ass",
          default: true,
        },
      ],
      fonts: [],
    });
    expect(parseDirectStream("<div></div>")).toBeUndefined();
  });
});

describe("matchDirectSeries", () => {
  const item = (
    slug: string,
    startYear: number,
    episodeCount: number,
    type = "TV Series",
  ): DirectSearchItem => ({
    slug,
    titles: [slug],
    type,
    startYear,
    episodeCount,
    ongoing: false,
  });
  const source = (items: DirectSearchItem[], firstAir: Record<string, string>) => ({
    search: async () => items,
    episodes: async (slug: string): Promise<DirectEpisode[]> =>
      firstAir[slug] ? [{ number: 1, airDate: firstAir[slug] }] : [],
  });
  const target = {
    titles: ["Frieren"],
    format: "TV",
    startDate: "2023-09-29",
    episodes: 28,
    airing: false,
  };

  it("accepts the one candidate whose year, format, count and first air date agree", async () => {
    const result = await matchDirectSeries(
      target,
      source([item("s1", 2023, 28), item("s2", 2026, 10), item("film", 2023, 1, "Movie")], {
        s1: "2023-09-29",
        s2: "2026-01-16",
      }),
    );
    expect(result).toBe("s1");
  });

  it("allows an online premiere a few weeks early", async () => {
    expect(
      await matchDirectSeries(
        { ...target, startDate: "2020-10-03", episodes: 24 },
        source([item("jjk", 2020, 24)], { jjk: "2020-09-19" }),
      ),
    ).toBe("jjk");
  });

  it("refuses ambiguity, wrong counts, partial dates and title-only matches", async () => {
    const twins = source([item("a", 2023, 28), item("b", 2023, 28)], {
      a: "2023-09-29",
      b: "2023-09-30",
    });
    expect(await matchDirectSeries(target, twins)).toBeUndefined();
    expect(
      await matchDirectSeries(target, source([item("a", 2023, 27)], { a: "2023-09-29" })),
    ).toBeUndefined();
    expect(await matchDirectSeries({ ...target, startDate: "2023-09" }, twins)).toBeUndefined();
    // Same year and count, but no first-episode date to confirm it: not accepted.
    expect(await matchDirectSeries(target, source([item("a", 2023, 28)], {}))).toBeUndefined();
  });

  it("lets an airing long runner's count drift within 1%", async () => {
    const airing = { ...target, startDate: "1999-10-20", episodes: 1180, airing: true };
    expect(
      await matchDirectSeries(airing, source([item("op", 1999, 1184)], { op: "1999-10-20" })),
    ).toBe("op");
    expect(
      await matchDirectSeries(airing, source([item("op", 1999, 1200)], { op: "1999-10-20" })),
    ).toBeUndefined();
  });

  it("also searches the title without season markers", () => {
    expect(searchQueries(["Sousou no Frieren 2nd Season", "Frieren Season 2"])).toEqual([
      "Sousou no Frieren 2nd Season",
      "Frieren Season 2",
      "Sousou no Frieren",
    ]);
    expect(searchQueries(["ONE PIECE"])).toEqual(["ONE PIECE"]);
  });
});

describe("assToVtt", () => {
  it("keeps dialogue text and timing, dropping styling, drawings and comments", () => {
    const ass = [
      "[Script Info]",
      "Title: x",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\NSecond line",
      "Comment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,ignored",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}",
      "Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,<b>&",
    ].join("\n");
    expect(assToVtt(ass)).toBe(
      "WEBVTT\n\n00:00:02.000 --> 00:00:03.000\n&lt;b&gt;&amp;\n\n00:00:05.000 --> 00:00:07.500\nHello, world\nSecond line\n",
    );
  });
});

describe("stream proxy URLs", () => {
  it("rewrites every playlist URI through the proxy", () => {
    const manifest = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/ja/playlist.m3u8"',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1"',
      "video/720.m3u8",
    ].join("\n");
    const rewritten = rewriteHlsManifest(
      manifest,
      "https://cdn.example/a/master.m3u8",
      (url) => `proxy:${url}`,
    );
    expect(rewritten).toContain('URI="proxy:https://cdn.example/a/audio/ja/playlist.m3u8"');
    expect(rewritten).toContain('URI="proxy:https://keys.example/k1"');
    expect(rewritten).toContain("proxy:https://cdn.example/a/video/720.m3u8");
  });

  it("refuses non-HTTPS, credentials and private hosts", () => {
    expect(() => requireHttpsUrl("http://cdn.example/a")).toThrow();
    expect(() => requireHttpsUrl("https://user:pw@cdn.example/a")).toThrow();
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.2",
      "192.168.1.5",
      "172.20.0.1",
      "169.254.1.1",
      "[::1]",
    ])
      expect(() => requireHttpsUrl(`https://${host}/a`)).toThrow();
    expect(requireHttpsUrl("https://cdn.example/a").hostname).toBe("cdn.example");
  });
});
