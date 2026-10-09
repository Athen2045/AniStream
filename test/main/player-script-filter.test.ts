import { describe, expect, it, vi } from "vitest";
import {
  installPlayerScriptFilter,
  isAllowedScript,
  isBlockedRequest,
  playerScriptPolicies,
  policyForFrame,
  type FrameLike,
} from "../../src/main/player-script-filter";
import { parseProviderConfig, type MoreTmdbEmbedProvider } from "../../src/main/provider-config";

const player = (patch: Partial<MoreTmdbEmbedProvider> = {}): MoreTmdbEmbedProvider => ({
  id: "more-player",
  kind: "tmdb-embed",
  movieUrl: "https://player.example/movie/{tmdbId}",
  tvUrl: "https://player.example/tv/{tmdbId}/{season}/{episode}",
  stripElectronUserAgent: false,
  origin: "https://player.example",
  ...patch,
});

const app: FrameLike = { origin: "http://localhost:5173", parent: null };
const frame = (origin: string, parent: FrameLike): FrameLike => ({ origin, parent });

describe("player script filter", () => {
  const [policy] = playerScriptPolicies([
    player({ scriptHosts: ["cast.example"] }),
    player({ id: "other", origin: "https://other.example" }),
  ]);

  it("covers only players that opted in, always allowing the player's own host", () => {
    expect(playerScriptPolicies([player()])).toEqual([]);
    expect(policy).toEqual({
      origin: "https://player.example",
      playerHost: "player.example",
      hosts: ["cast.example"],
      blockedPaths: [],
      blockedHosts: [],
    });
  });

  it("blocks configured paths on the player's own host, with or without an allowlist", () => {
    const [pathsOnly, both] = playerScriptPolicies([
      player({ blockedScriptPaths: ["/lib/ad.js"] }),
      player({ id: "both", scriptHosts: ["cast.example"], blockedScriptPaths: ["/lib/ad.js"] }),
    ]);
    expect(pathsOnly).toEqual({
      origin: "https://player.example",
      playerHost: "player.example",
      blockedPaths: ["/lib/ad.js"],
      blockedHosts: [],
    });
    expect(isAllowedScript("https://player.example/lib/ad.js", pathsOnly!)).toBe(false);
    expect(isAllowedScript("https://player.example/lib/ad.js?v=2", pathsOnly!)).toBe(false);
    expect(isAllowedScript("https://player.example/assets/app.js", pathsOnly!)).toBe(true);
    // Without an allowlist other hosts are untouched; the path rule is for the player host only.
    expect(isAllowedScript("https://cdn.other.example/lib/ad.js", pathsOnly!)).toBe(true);
    expect(isAllowedScript("https://player.example/lib/ad.js", both!)).toBe(false);
    expect(isAllowedScript("https://player.example/assets/app.js", both!)).toBe(true);
    expect(isAllowedScript("https://ads.example/x.js", both!)).toBe(false);
  });

  it("applies to the player frame and frames nested in it, never to the app itself", () => {
    const playerFrame = frame("https://player.example", app);
    expect(policyForFrame(playerFrame, [policy!])).toBe(policy);
    expect(policyForFrame(frame("https://ads.example", playerFrame), [policy!])).toBe(policy);
    expect(policyForFrame(app, [policy!])).toBeUndefined();
    expect(policyForFrame(frame("https://other.example", app), [policy!])).toBeUndefined();
    expect(policyForFrame(null, [policy!])).toBeUndefined();
  });

  it("allows https scripts from listed hosts and their subdomains only", () => {
    expect(isAllowedScript("https://player.example/_next/app.js", policy!)).toBe(true);
    // The player's own subdomains (e.g. an analytics host) are not implied.
    expect(isAllowedScript("https://stats.player.example/s.js", policy!)).toBe(false);
    expect(isAllowedScript("https://www.cast.example/sdk.js", policy!)).toBe(true);
    expect(isAllowedScript("https://qcmc.random-ads.example/kH6j/JLk", policy!)).toBe(false);
    expect(isAllowedScript("https://player.example.evil.example/x.js", policy!)).toBe(false);
    expect(isAllowedScript("http://player.example/x.js", policy!)).toBe(false);
    expect(isAllowedScript("not a url", policy!)).toBe(false);
  });

  it("cancels only disallowed script requests from inside an opted-in player", () => {
    let listener:
      | ((details: Record<string, unknown>, callback: (response: object) => void) => void)
      | undefined;
    const session = {
      webRequest: { onBeforeRequest: vi.fn((_filter, fn) => (listener = fn)) },
    };
    installPlayerScriptFilter(session as never, [player({ scriptHosts: ["cast.example"] })]);
    const decide = (details: Record<string, unknown>): object => {
      let response: object = {};
      listener!(details, (value) => (response = value));
      return response;
    };
    const playerFrame = frame("https://player.example", app);
    expect(
      decide({ resourceType: "script", url: "https://ads.example/a.js", frame: playerFrame }),
    ).toEqual({ cancel: true });
    expect(
      decide({ resourceType: "script", url: "https://cast.example/a.js", frame: playerFrame }),
    ).toEqual({});
    expect(
      decide({ resourceType: "image", url: "https://ads.example/a.png", frame: playerFrame }),
    ).toEqual({});
    expect(decide({ resourceType: "script", url: "https://ads.example/a.js", frame: app })).toEqual(
      {},
    );
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ["*://*/*"], types: ["script"] },
      expect.any(Function),
    );
  });

  it("refuses any request type to blocked tracker hosts, and only from the player", () => {
    let listener:
      | ((details: Record<string, unknown>, callback: (response: object) => void) => void)
      | undefined;
    const session = {
      webRequest: { onBeforeRequest: vi.fn((_filter, fn) => (listener = fn)) },
    };
    installPlayerScriptFilter(session as never, [
      player({ scriptHosts: ["cast.example"], blockedRequestHosts: ["stats.example"] }),
    ]);
    const decide = (details: Record<string, unknown>): object => {
      let response: object = {};
      listener!(details, (value) => (response = value));
      return response;
    };
    const playerFrame = frame("https://player.example", app);
    const pixel = "https://prd.stats.example/v1/ping.gif?e=s";
    expect(decide({ resourceType: "image", url: pixel, frame: playerFrame })).toEqual({
      cancel: true,
    });
    expect(decide({ resourceType: "ping", url: pixel, frame: playerFrame })).toEqual({
      cancel: true,
    });
    expect(decide({ resourceType: "xhr", url: pixel, frame: playerFrame })).toEqual({
      cancel: true,
    });
    // Media and images from other hosts, and the app's own requests, are untouched.
    expect(
      decide({ resourceType: "xhr", url: "https://cdn.example/seg-1.ts", frame: playerFrame }),
    ).toEqual({});
    expect(
      decide({ resourceType: "image", url: "https://cdn.example/poster.jpg", frame: playerFrame }),
    ).toEqual({});
    expect(decide({ resourceType: "image", url: pixel, frame: app })).toEqual({});
    expect(decide({ resourceType: "media", url: pixel, frame: playerFrame })).toEqual({});
    // A script on a blocked host is refused even when the allowlist would cover it.
    expect(
      decide({ resourceType: "script", url: "https://stats.example/a.js", frame: playerFrame }),
    ).toEqual({ cancel: true });
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ["*://*/*"], types: ["script", "image", "ping", "xhr"] },
      expect.any(Function),
    );
  });

  it("matches blocked hosts exactly or as a parent domain", () => {
    const [blocking] = playerScriptPolicies([player({ blockedRequestHosts: ["stats.example"] })]);
    expect(blocking).toMatchObject({ blockedHosts: ["stats.example"] });
    expect(isBlockedRequest("https://stats.example/p.gif", blocking!)).toBe(true);
    expect(isBlockedRequest("https://a.b.stats.example/p.gif", blocking!)).toBe(true);
    expect(isBlockedRequest("https://notstats.example/p.gif", blocking!)).toBe(false);
    expect(isBlockedRequest("https://stats.example.evil.example/p.gif", blocking!)).toBe(false);
    expect(isBlockedRequest("not a url", blocking!)).toBe(false);
    // Blocked hosts alone turn the policy on without restricting other scripts.
    expect(isAllowedScript("https://cdn.other.example/app.js", blocking!)).toBe(true);
  });

  it("installs nothing when no player opted in", () => {
    const onBeforeRequest = vi.fn();
    installPlayerScriptFilter({ webRequest: { onBeforeRequest } } as never, [player()]);
    expect(onBeforeRequest).not.toHaveBeenCalled();
  });

  it("parses scriptHosts from the provider config and drops an invalid entry", () => {
    const more = (entry: object) =>
      parseProviderConfig({
        version: 2,
        more: {
          media: [
            {
              id: "more-player",
              kind: "tmdb-embed",
              movieUrl: "https://player.example/movie/{tmdbId}",
              tvUrl: "https://player.example/tv/{tmdbId}/{season}/{episode}",
              ...entry,
            },
          ],
        },
      }).more.media;
    expect(more({ scriptHosts: ["cast.example"] })[0]?.scriptHosts).toEqual(["cast.example"]);
    expect(more({})[0]?.scriptHosts).toBeUndefined();
    expect(more({ scriptHosts: ["Not A Host"] })).toEqual([]);
    expect(more({ blockedScriptPaths: ["/lib/ad.js"] })[0]?.blockedScriptPaths).toEqual([
      "/lib/ad.js",
    ]);
    expect(more({ blockedScriptPaths: ["lib/ad.js"] })).toEqual([]);
    expect(more({ blockedScriptPaths: ["https://player.example/lib/ad.js"] })).toEqual([]);
    expect(more({ blockedScriptPaths: [] })).toEqual([]);
    expect(more({ blockedRequestHosts: ["stats.example"] })[0]?.blockedRequestHosts).toEqual([
      "stats.example",
    ]);
    expect(more({ blockedRequestHosts: ["https://stats.example"] })).toEqual([]);
    expect(more({ blockedRequestHosts: [] })).toEqual([]);
  });

  it("parses scriptHosts on an anime player entry too", () => {
    const anime = parseProviderConfig({
      version: 2,
      anime: {
        media: [
          {
            id: "anime-player",
            kind: "indexed-embed",
            recentIndexUrl: "https://episode-index.example/recent",
            seriesUrl: "https://episode-index.example/series/{seriesId}",
            episodeEmbedUrl: "https://anime-player.example/embed/{embedId}/{audio}",
            aniListEmbedUrl: "https://anime-player.example/anilist/{aniListId}/{episode}/{audio}",
            scriptHosts: ["lib.example"],
            blockedRequestHosts: ["stats.example"],
          },
        ],
      },
    }).anime.media;
    expect(anime[0]).toMatchObject({
      playerOrigin: "https://anime-player.example",
      scriptHosts: ["lib.example"],
      blockedRequestHosts: ["stats.example"],
    });
  });
});
