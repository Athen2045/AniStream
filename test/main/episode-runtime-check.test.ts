import { describe, expect, it } from "vitest";
import {
  checkEpisodeRuntime,
  measureHlsSeconds,
  playlistSeconds,
} from "../../src/main/episode-runtime-check";

const minutes = (value: number): number => value * 60;

describe("checkEpisodeRuntime", () => {
  it("flags the mislabelled One Piece episode 1 against its own runtime", () => {
    // Measured 2026-10-18: the source's "episode 1" was the 23.34 min HEROINES special; TheTVDB says 25.
    expect(
      checkEpisodeRuntime({ actualSeconds: minutes(23.34), episodeMinutes: 25, seriesMinutes: 24 }),
    ).toEqual({ actualSeconds: 1400, expectedSeconds: 1500, basis: "episode", mismatch: true });
  });

  it("accepts genuine episodes measured the same day", () => {
    const genuine: [number, number][] = [
      [24.62, 25], // One Piece E2
      [24.0, 25], // One Piece E500
      [23.6, 23], // One Piece E1150
      [26.0, 26], // Frieren E1
      [24.5, 25], // Frieren E10
      [25.68, 26], // Attack on Titan E1
      [24.18, 24], // Attack on Titan E2
    ];
    for (const [actual, episodeMinutes] of genuine)
      expect(
        checkEpisodeRuntime({ actualSeconds: minutes(actual), episodeMinutes, seriesMinutes: 24 })
          ?.mismatch,
      ).toBe(false);
  });

  it("uses AniList's series average only for gross mixups", () => {
    // Without a per-episode runtime, the 23.34 min special cannot be told from a 24 min episode...
    expect(checkEpisodeRuntime({ actualSeconds: minutes(23.34), seriesMinutes: 24 })).toMatchObject(
      {
        basis: "series",
        mismatch: false,
      },
    );
    // ...but a film or a short in place of an episode can.
    expect(checkEpisodeRuntime({ actualSeconds: minutes(110), seriesMinutes: 24 })?.mismatch).toBe(
      true,
    );
    expect(checkEpisodeRuntime({ actualSeconds: minutes(12), seriesMinutes: 24 })?.mismatch).toBe(
      true,
    );
  });

  it("returns nothing without a measurement or an expectation", () => {
    expect(checkEpisodeRuntime({ actualSeconds: undefined, episodeMinutes: 24 })).toBeUndefined();
    expect(checkEpisodeRuntime({ actualSeconds: 1400 })).toBeUndefined();
  });
});

describe("HLS length", () => {
  const media = "#EXTM3U\n#EXTINF:10.0,\na.ts\n#EXTINF:4.5,\nb.ts\n#EXT-X-ENDLIST";

  it("sums segment durations", () => {
    expect(playlistSeconds(media)).toBe(14.5);
  });

  it("follows a master playlist to its first variant", async () => {
    const master = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/ja.m3u8"',
      "#EXT-X-STREAM-INF:BANDWIDTH=1",
      "video/720.m3u8",
    ].join("\n");
    const asked: string[] = [];
    const seconds = await measureHlsSeconds("https://cdn.example/x/master.m3u8", async (url) => {
      asked.push(url);
      return url.endsWith("master.m3u8") ? master : media;
    });
    expect(seconds).toBe(14.5);
    expect(asked).toEqual([
      "https://cdn.example/x/master.m3u8",
      "https://cdn.example/x/video/720.m3u8",
    ]);
  });

  it("is undefined for a playlist without segments or variants", async () => {
    expect(
      await measureHlsSeconds("https://cdn.example/m.m3u8", async () => "#EXTM3U"),
    ).toBeUndefined();
  });
});
