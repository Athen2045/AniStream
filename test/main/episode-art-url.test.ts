import { describe, expect, it } from "vitest";
import {
  artworkSourceFromCacheUrl,
  cachedEpisodeArtUrl,
  episodeArtSourceFromCacheUrl,
} from "../../src/shared/artwork";

const tvdb = "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/a.jpg";

describe("episode-art cache URLs", () => {
  it("round-trips allowed episode image hosts through their own scheme host", () => {
    const cached = cachedEpisodeArtUrl(tvdb);
    expect(cached.startsWith("anistream-art://episode/?src=")).toBe(true);
    expect(episodeArtSourceFromCacheUrl(cached)).toBe(tvdb);
    // The cover/banner cache never resolves an episode URL.
    expect(artworkSourceFromCacheUrl(cached)).toBeUndefined();
  });

  it("leaves other URLs alone and refuses forged ones", () => {
    expect(cachedEpisodeArtUrl("https://evil.example/a.jpg")).toBe("https://evil.example/a.jpg");
    expect(
      episodeArtSourceFromCacheUrl(
        `anistream-art://episode/?src=${encodeURIComponent("https://evil.example/a.jpg")}`,
      ),
    ).toBeUndefined();
    expect(
      episodeArtSourceFromCacheUrl(`anistream-art://image/?src=${encodeURIComponent(tvdb)}`),
    ).toBeUndefined();
  });
});
