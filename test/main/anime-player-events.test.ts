import { describe, expect, it } from "vitest";
import { parseAnimePlayerMessage } from "../../src/shared/anime-player-events";

describe("Anime player message validation", () => {
  it("accepts documented progress and completion events", () => {
    expect(
      parseAnimePlayerMessage({ event: "time", time: 90, duration: 100, percent: 90 }),
    ).toEqual({
      kind: "progress",
      currentTime: 90,
      duration: 100,
      percent: 90,
    });
    expect(
      parseAnimePlayerMessage(
        JSON.stringify({ type: "watching-log", currentTime: 15, duration: 24 }),
      ),
    ).toEqual({
      kind: "progress",
      currentTime: 15,
      duration: 24,
    });
    expect(parseAnimePlayerMessage({ event: "complete" })).toEqual({ kind: "complete" });
  });

  it("rejects malformed, oversized, or out-of-range messages", () => {
    expect(parseAnimePlayerMessage({ event: "time", time: -1, duration: 100 })).toBeUndefined();
    expect(parseAnimePlayerMessage({ event: "time", time: 1, duration: 0 })).toBeUndefined();
    expect(parseAnimePlayerMessage({ event: "time", time: 1, duration: 2, percent: 101 })).toEqual({
      kind: "progress",
      currentTime: 1,
      duration: 2,
      percent: undefined,
    });
    expect(parseAnimePlayerMessage("x".repeat(4_097))).toBeUndefined();
  });

  it("reads a sourced player's events with the AniList id, episode and audio it reports", () => {
    const event = (name: string, data: Record<string, unknown>) => ({
      source: "player",
      version: 1,
      type: "event",
      name,
      data,
    });
    const playing = {
      animeId: "154587",
      episode: 2,
      language: "sub",
      currentTime: 30.5,
      duration: 1561,
      percentage: 1.95,
    };
    expect(parseAnimePlayerMessage(event("progress", playing), "player")).toEqual({
      kind: "progress",
      currentTime: 30.5,
      duration: 1561,
      percent: 1.95,
      aniListId: 154587,
      episode: 2,
      language: "sub",
    });
    expect(parseAnimePlayerMessage(event("pause", playing), "player")).toMatchObject({
      kind: "progress",
    });
    expect(parseAnimePlayerMessage(event("ended", playing), "player")).toEqual({
      kind: "complete",
      aniListId: 154587,
      episode: 2,
      language: "sub",
    });
    expect(parseAnimePlayerMessage(event("error", { message: "  No  source " }), "player")).toEqual(
      {
        kind: "error",
        message: "No source",
      },
    );
  });

  it("ignores other formats, sources and malformed data for a sourced player", () => {
    const ok = { animeId: "1", episode: 1, currentTime: 1, duration: 100 };
    const sent = (message: Record<string, unknown>) => parseAnimePlayerMessage(message, "player");
    expect(sent({ source: "other", type: "event", name: "progress", data: ok })).toBeUndefined();
    expect(sent({ source: "player", type: "command", name: "progress", data: ok })).toBeUndefined();
    expect(
      sent({ source: "player", type: "event", name: "settingschange", data: ok }),
    ).toBeUndefined();
    expect(
      sent({ source: "player", type: "event", name: "progress", data: { ...ok, duration: 0 } }),
    ).toBeUndefined();
    expect(sent({ event: "time", time: 1, duration: 100 })).toBeUndefined();
    const odd = sent({
      source: "player",
      type: "event",
      name: "progress",
      data: { ...ok, animeId: "x1", language: "fr" },
    });
    expect(odd).toMatchObject({ kind: "progress" });
    expect(odd).not.toHaveProperty("aniListId");
    expect(odd).not.toHaveProperty("language");
  });
});
