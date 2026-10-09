import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("../../src/main/ipc", () => ({
  registerTrustedIpcHandler: (_origin: string, channel: string, handler: never) =>
    handlers.set(channel, handler),
}));

const { registerMoreDomain } = await import("../../src/main/domains/more");
const { parseProviderConfig } = await import("../../src/main/provider-config");

const player = (id: string, host: string, strip = false) => ({
  id,
  kind: "tmdb-embed",
  movieUrl: `https://${host}/m/{tmdbId}`,
  tvUrl: `https://${host}/t/{tmdbId}/{season}/{episode}`,
  stripElectronUserAgent: strip,
});

describe("More player selection", () => {
  const frameUa = { arm: vi.fn(async () => undefined), disarm: vi.fn() };
  beforeEach(() => {
    handlers.clear();
    frameUa.arm.mockClear();
    frameUa.disarm.mockClear();
    const { more } = parseProviderConfig({
      more: { media: [player("primary", "a.example", true), player("backup", "b.example")] },
    });
    registerMoreDomain("app://x", {
      tmdb: {} as never,
      database: undefined,
      players: more.media,
      frameUserAgent: () => frameUa as never,
    });
  });
  const prepare = (input: object) => handlers.get("more:player-prepare")!({}, input);

  it("serves the primary by default and arms the UA override only for an opted-in player", async () => {
    await expect(prepare({ tmdbId: 5, type: "MOVIE" })).resolves.toEqual({
      url: "https://a.example/m/5",
      providerIndex: 0,
      providerCount: 2,
    });
    expect(frameUa.arm).toHaveBeenCalledWith("https://a.example");
  });

  it("serves a fallback player by index with the truthful UA", async () => {
    await expect(
      prepare({ tmdbId: 5, type: "TV", season: 1, episode: 2, providerIndex: 1 }),
    ).resolves.toEqual({ url: "https://b.example/t/5/1/2", providerIndex: 1, providerCount: 2 });
    expect(frameUa.arm).not.toHaveBeenCalled();
    expect(frameUa.disarm).toHaveBeenCalled();
  });

  it("rejects an index past the configured players", async () => {
    await expect(prepare({ tmdbId: 5, type: "MOVIE", providerIndex: 2 })).rejects.toThrow(
      /No further More player/,
    );
  });
});

const { openAppDatabase } = await import("../../src/main/database");

describe("More ratings", () => {
  const movie = { id: 27205, type: "MOVIE" as const, title: "Sample Movie" };
  const show = { id: 1399, type: "TV" as const, title: "Sample Show" };

  it("unlocks rating only for completed titles and finished movies", async () => {
    handlers.clear();
    const database = openAppDatabase(":memory:");
    try {
      registerMoreDomain("app://x", {
        tmdb: {} as never,
        database,
        players: [],
        frameUserAgent: () => undefined,
      });
      const rating = (ref: object) => handlers.get("more:rating")!({}, ref);
      const rate = (title: object, value: number | null) =>
        handlers.get("more:rating-set")!({}, title, value);

      expect(await rating({ type: "MOVIE", tmdbId: movie.id })).toMatchObject({ canRate: false });
      await expect(rate(movie, 8)).rejects.toThrow(/before rating/);

      database.setMoreCompleted(movie, true);
      expect(await rating({ type: "MOVIE", tmdbId: movie.id })).toMatchObject({ canRate: true });
      await expect(rate(movie, 8)).resolves.toEqual({ simkl: "skipped" });
      expect(database.getMoreRating({ type: "MOVIE", tmdbId: movie.id })).toBe(8);

      // A show with watched episodes is not finished until it is marked Completed.
      database.rememberMoreTitle(show);
      expect(await rating({ type: "TV", tmdbId: show.id })).toMatchObject({ canRate: false });
      await expect(rate(movie, null)).resolves.toEqual({ simkl: "skipped" });
    } finally {
      database.close();
    }
  });
});
