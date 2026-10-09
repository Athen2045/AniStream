import { describe, expect, it } from "vitest";
import { buildMorePlayerUrl } from "../../src/main/more-player-url";
import { parseProviderConfig } from "../../src/main/provider-config";

const config = parseProviderConfig({
  more: {
    media: [
      {
        id: "more-player",
        kind: "tmdb-embed",
        movieUrl: "https://more.example/movie/{tmdbId}?autoPlay=true&hideServer=false",
        tvUrl: "https://more.example/tv/{tmdbId}/{season}/{episode}?autoPlay=true&autoNext=true",
        startAtParam: "startAt",
      },
    ],
  },
}).more.media[0]!;

describe("More player URL", () => {
  it("fills the configured movie template", () => {
    const url = new URL(buildMorePlayerUrl(config, { tmdbId: 27205, type: "MOVIE" }));
    expect(url.origin).toBe("https://more.example");
    expect(url.pathname).toBe("/movie/27205");
    expect(url.searchParams.get("autoPlay")).toBe("true");
    expect(url.searchParams.get("hideServer")).toBe("false");
  });

  it("fills the configured TV template and requires a season and episode", () => {
    const url = new URL(
      buildMorePlayerUrl(config, { tmdbId: 93405, type: "TV", season: 1, episode: 2 }),
    );
    expect(url.pathname).toBe("/tv/93405/1/2");
    expect(url.searchParams.get("autoNext")).toBe("true");
    expect(() => buildMorePlayerUrl(config, { tmdbId: 93405, type: "TV" })).toThrow();
    expect(() => buildMorePlayerUrl(config, { tmdbId: 0, type: "MOVIE" })).toThrow();
  });

  it("adds the configured resume parameter only for a positive saved position", () => {
    const resumed = new URL(
      buildMorePlayerUrl(config, { tmdbId: 27205, type: "MOVIE", startAtSeconds: 125.8 }),
    );
    expect(resumed.searchParams.get("startAt")).toBe("125");
    const fresh = new URL(
      buildMorePlayerUrl(config, { tmdbId: 27205, type: "MOVIE", startAtSeconds: 0 }),
    );
    expect(fresh.searchParams.has("startAt")).toBe(false);
    const noParam = new URL(
      buildMorePlayerUrl(
        { ...config, startAtParam: undefined },
        { tmdbId: 27205, type: "MOVIE", startAtSeconds: 90 },
      ),
    );
    expect(noParam.searchParams.has("startAt")).toBe(false);
  });
});
