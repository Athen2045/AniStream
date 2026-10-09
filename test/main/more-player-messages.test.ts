import { describe, expect, it } from "vitest";
import { parseMorePlayerMessage } from "../../src/shared/more-player-messages";

describe("More player message validation", () => {
  it("accepts documented movie progress and player-status events", () => {
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: {
          event: "timeupdate",
          currentTime: 120,
          duration: 600,
          tmdbId: 27205,
          mediaType: "movie",
        },
      }),
    ).toEqual({
      kind: "progress",
      currentTime: 120,
      duration: 600,
      id: "27205",
      mediaType: "movie",
    });

    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: {
          event: "playerstatus",
          currentTime: 121,
          duration: 600,
          tmdbId: 27205,
          mediaType: "movie",
        },
      }),
    ).toEqual({
      kind: "progress",
      currentTime: 121,
      duration: 600,
      id: "27205",
      mediaType: "movie",
    });
  });

  it("accepts completion and bounded provider errors", () => {
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "ended", tmdbId: 93405, mediaType: "tv" },
      }),
    ).toEqual({ kind: "ended", id: "93405", mediaType: "tv" });

    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "error", message: "  source unavailable  " },
      }),
    ).toEqual({ kind: "error", message: "source unavailable" });
  });

  it("rejects malformed, invalid, and unrecognized events", () => {
    expect(parseMorePlayerMessage([])).toBeUndefined();
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "timeupdate", currentTime: -1, duration: 20, tmdbId: 1, mediaType: "movie" },
      }),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "timeupdate", currentTime: 1, duration: 0, tmdbId: 1, mediaType: "movie" },
      }),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: {
          event: "timeupdate",
          currentTime: 1,
          duration: 20,
          tmdbId: "1",
          mediaType: "movie",
        },
      }),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "timeupdate", currentTime: 1, duration: 20, tmdbId: 1, mediaType: "anime" },
      }),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({
        type: "OTHER_EVENT",
        data: { event: "ended", tmdbId: 1, mediaType: "movie" },
      }),
    ).toBeUndefined();
  });

  it("carries the documented TV season and episode fields", () => {
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: {
          event: "timeupdate",
          currentTime: 5,
          duration: 50,
          tmdbId: 93405,
          mediaType: "tv",
          season: 1,
          episode: 2,
        },
      }),
    ).toMatchObject({ kind: "progress", season: 1, episode: 2 });
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "ended", tmdbId: 27205, mediaType: "movie", season: null, episode: null },
      }),
    ).toEqual({ kind: "ended", id: "27205", mediaType: "movie" });
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "ended", tmdbId: 93405, mediaType: "tv", season: 0, episode: "2" },
      }),
    ).toEqual({ kind: "ended", id: "93405", mediaType: "tv" });
  });

  it("parses the server-list status message the player posts after loading", () => {
    expect(parseMorePlayerMessage({ event: "status", data: 500 })).toEqual({
      kind: "status",
      httpStatus: 500,
    });
    expect(parseMorePlayerMessage({ event: "status", data: 200 })).toEqual({
      kind: "status",
      httpStatus: 200,
    });
    expect(parseMorePlayerMessage({ event: "status", data: "500" })).toBeUndefined();
    expect(parseMorePlayerMessage({ event: "status", data: 50.5 })).toBeUndefined();
    expect(parseMorePlayerMessage({ event: "status", data: 99 })).toBeUndefined();
    expect(parseMorePlayerMessage({ event: "status", data: 600 })).toBeUndefined();
    expect(parseMorePlayerMessage({ type: "MEDIA_DATA", data: {} })).toBeUndefined();
  });
});
