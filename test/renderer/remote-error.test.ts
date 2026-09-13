import { describe, expect, it } from "vitest";
import { friendlyPlaybackError, friendlyRemoteError } from "../../src/renderer/src/remote-error";

const options = {
  provider: "AniList",
  operation: "search results",
  fallback: "Search is unavailable right now.",
};

describe("friendly remote errors", () => {
  it("turns rate limits, deadlines, and connectivity failures into recovery guidance", () => {
    expect(friendlyRemoteError(new Error("HTTP 429"), options)).toMatch(/busy.*few minutes/i);
    expect(
      friendlyRemoteError(
        new Error(
          "Error invoking remote method 'anilist:browse': Error: AniList is rate-limiting requests right now.",
        ),
        options,
      ),
    ).toMatch(/busy.*few minutes/i);
    expect(friendlyRemoteError(new DOMException("expired", "TimeoutError"), options)).toMatch(
      /taking longer.*moment/i,
    );
    expect(friendlyRemoteError(new Error("fetch failed: ENOTFOUND"), options)).toMatch(
      /check your connection/i,
    );
  });

  it("mentions retained data and hides unknown provider internals", () => {
    expect(friendlyRemoteError(new Error("HTTP 429"), { ...options, retained: true })).toContain(
      "previous search results remain available",
    );
    expect(friendlyRemoteError(new Error("internal resolver 17"), options)).toBe(options.fallback);
  });

  it("turns expired sessions and malformed provider data into useful next steps", () => {
    expect(friendlyRemoteError(new Error("Connect your AniList account first."), options)).toBe(
      "Connect AniList from Profile to manage your library.",
    );
    expect(friendlyRemoteError(new Error("HTTP 401 Unauthorized: token expired"), options)).toBe(
      "Your AniList connection has expired. Open Profile and reconnect, then try again.",
    );
    expect(friendlyRemoteError(new Error("malformed GraphQL response"), options)).toBe(
      "AniList returned incomplete data. Try again shortly.",
    );
    expect(friendlyRemoteError(new Error("HTTP 503 Service Unavailable"), options)).toBe(
      "AniList is temporarily unavailable. Try again shortly.",
    );
  });

  it("never exposes player codes and suggests another playable choice", () => {
    expect(friendlyPlaybackError(new Error("Provider error 233403"))).toBe(
      "This episode is unavailable from the player right now. Try another audio option or episode.",
    );
    expect(friendlyPlaybackError(new Error("socket timeout"))).toMatch(
      /taking longer.*retry the player/i,
    );
    expect(friendlyPlaybackError(new Error("internal resolver 17"))).not.toContain("resolver");
  });
});
