import { describe, expect, it } from "vitest";
import {
  createSourcedEventReader,
  parseMorePlayerMessage,
} from "../../src/shared/more-player-messages";

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

  it("accepts players that post JSON text with a string id", () => {
    const text = JSON.stringify({
      type: "PLAYER_EVENT",
      data: {
        event: "timeupdate",
        currentTime: 0.17,
        duration: 1588,
        id: "322723",
        mediaType: "tv",
        season: 1,
        episode: 1,
      },
    });
    expect(parseMorePlayerMessage(text)).toEqual({
      kind: "progress",
      currentTime: 0.17,
      duration: 1588,
      id: "322723",
      mediaType: "tv",
      season: 1,
      episode: 1,
    });
    // `type` as the media type; play events without a position carry no progress.
    expect(
      parseMorePlayerMessage(
        JSON.stringify({
          type: "PLAYER_EVENT",
          data: { event: "ended", id: "27205", type: "movie" },
        }),
      ),
    ).toEqual({ kind: "ended", id: "27205", mediaType: "movie" });
  });

  it("ignores text that is not a small JSON player event", () => {
    expect(parseMorePlayerMessage("PLAYER_EVENT")).toBeUndefined();
    expect(parseMorePlayerMessage("{not json")).toBeUndefined();
    expect(
      parseMorePlayerMessage(JSON.stringify({ type: "MEDIA_DATA", data: "{}" })),
    ).toBeUndefined();
    const huge = JSON.stringify({
      type: "PLAYER_EVENT",
      data: {
        event: "timeupdate",
        currentTime: 1,
        duration: 2,
        id: "1",
        mediaType: "tv",
        pad: "x".repeat(9_000),
      },
    });
    expect(parseMorePlayerMessage(huge)).toBeUndefined();
    // Ids must still be plain positive integers.
    for (const id of ["0", "01", "12a", "-5", "1e3", ""])
      expect(
        parseMorePlayerMessage({
          type: "PLAYER_EVENT",
          data: { event: "timeupdate", currentTime: 1, duration: 2, id, mediaType: "tv" },
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
    // Players that post numbers as text still say which episode is playing.
    expect(
      parseMorePlayerMessage({
        type: "PLAYER_EVENT",
        data: { event: "ended", tmdbId: 93405, mediaType: "tv", season: "1", episode: "3" },
      }),
    ).toEqual({ kind: "ended", id: "93405", mediaType: "tv", season: 1, episode: 3 });
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

  it("attributes prefixed events without a TMDB id to the title opened in the frame", () => {
    const opened = { eventPrefix: "player:", id: "111110", mediaType: "tv" as const };
    expect(
      parseMorePlayerMessage(
        { type: "player:timeupdate", currentTime: 30, duration: 3936 },
        opened,
      ),
    ).toEqual({ kind: "progress", currentTime: 30, duration: 3936, id: "111110", mediaType: "tv" });
    expect(parseMorePlayerMessage({ type: "player:pause" }, opened)).toEqual({
      kind: "playing",
      playing: false,
    });
    expect(parseMorePlayerMessage({ type: "player:ended" }, opened)).toEqual({
      kind: "ended",
      id: "111110",
      mediaType: "tv",
    });
    expect(
      parseMorePlayerMessage({ type: "player:error", error: "  No  sources " }, opened),
    ).toEqual({ kind: "error", message: "No sources" });
    expect(
      parseMorePlayerMessage(
        { type: "player:nextepisode", season: 1, episode: 2, internalNavigation: true },
        opened,
      ),
    ).toEqual({ kind: "episode", season: 1, episode: 2 });
    // A movie has no next episode.
    expect(
      parseMorePlayerMessage(
        { type: "player:nextepisode", season: 1, episode: 2 },
        { ...opened, mediaType: "movie" },
      ),
    ).toBeUndefined();
  });

  it("rejects malformed prefixed events and other formats for a prefixed player", () => {
    const opened = { eventPrefix: "player:", id: "550", mediaType: "movie" as const };
    expect(
      parseMorePlayerMessage({ type: "player:timeupdate", currentTime: -1, duration: 60 }, opened),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({ type: "player:timeupdate", currentTime: 1, duration: 0 }, opened),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({ type: "other:timeupdate", currentTime: 1, duration: 60 }, opened),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage({ type: "player:volumechange", volume: 1 }, opened),
    ).toBeUndefined();
    expect(
      parseMorePlayerMessage(
        { type: "PLAYER_EVENT", data: { event: "ended", tmdbId: 550, mediaType: "movie" } },
        opened,
      ),
    ).toBeUndefined();
    expect(parseMorePlayerMessage("player:ended", opened)).toBeUndefined();
  });

  it("reads source-tagged events, pairing positions with the last reported duration", () => {
    const read = createSourcedEventReader({ eventSource: "player", id: "111110", mediaType: "tv" });
    const event = (name: string, info: unknown) => ({ source: "player", event: name, info });
    // No duration yet: a position alone is not progress.
    expect(read(event("time", 3))).toBeUndefined();
    expect(read(event("duration", 3864.6))).toBeUndefined();
    expect(read(event("time", 15.5))).toEqual({
      kind: "progress",
      currentTime: 15.5,
      duration: 3864.6,
      id: "111110",
      mediaType: "tv",
    });
    expect(read(event("seek", 60))).toMatchObject({ kind: "progress", currentTime: 60 });
    expect(read(event("pause", null))).toEqual({ kind: "playing", playing: false });
    expect(read(event("ended", null))).toEqual({ kind: "ended", id: "111110", mediaType: "tv" });
    // One of its own servers failing is not a player failure; it tries the next server itself.
    expect(read(event("error", "Server 1 failed (embed)"))).toBeUndefined();
    expect(read(event("serverchange", "Server 2"))).toBeUndefined();
  });

  it("ignores other sources and malformed source-tagged events", () => {
    const read = createSourcedEventReader({ eventSource: "player", id: "550", mediaType: "movie" });
    read({ source: "player", event: "duration", info: 6000 });
    expect(read({ source: "other", event: "time", info: 5 })).toBeUndefined();
    expect(read({ source: "player", event: "time", info: -1 })).toBeUndefined();
    expect(read({ source: "player", event: "time", info: "5" })).toBeUndefined();
    expect(read({ source: "player", event: "duration", info: 0 })).toBeUndefined();
    expect(read({ source: "player", event: "time", info: 5 })).toMatchObject({ duration: 6000 });
    expect(read("player:time")).toBeUndefined();
    expect(read(null)).toBeUndefined();
  });
});
