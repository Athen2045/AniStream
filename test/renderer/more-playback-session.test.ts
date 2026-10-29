import { describe, expect, it, vi } from "vitest";
import type { MorePlayerMessage } from "../../src/shared/more-player-messages";
import {
  createMorePlaybackSession,
  readMorePlayerMessage,
} from "../../src/renderer/src/more-playback-session";

// The session receives messages already accepted by readMorePlayerMessage.
const progress = (
  id: string,
  mediaType: "movie" | "tv",
  position: { season?: number; episode?: number } = {},
): MorePlayerMessage => ({
  kind: "progress",
  currentTime: 20,
  duration: 100,
  id,
  mediaType,
  ...position,
});

describe("MorePlaybackSession", () => {
  it("never saves progress from a video of the wrong length for what was opened", () => {
    const saveResume = vi.fn().mockResolvedValue(undefined);
    const session = createMorePlaybackSession({
      tmdbId: 37854,
      type: "TV",
      season: 1,
      episode: 1,
      attempt: 0,
      saveResume,
      isWrongDuration: (seconds) => seconds > 3000,
    });
    const wrong = (currentTime: number): MorePlayerMessage => ({
      ...progress("37854", "tv", { season: 1, episode: 1 }),
      currentTime,
      duration: 3867,
    });
    session.handleEvent(wrong(10));
    session.handleEvent(wrong(3600));
    session.handleEvent({ kind: "ended", id: "37854", mediaType: "tv" });
    expect(saveResume).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ durationSeconds: 3867, ended: false });
    // The right length saves as usual.
    session.handleEvent({ ...wrong(30), duration: 1500 });
    expect(saveResume).toHaveBeenCalledWith(
      expect.objectContaining({ positionSeconds: 30, durationSeconds: 1500 }),
    );
    session.dispose();
  });

  it("counts playback as started only once the reported position advances", () => {
    const session = createMorePlaybackSession({
      tmdbId: 27205,
      type: "MOVIE",
      attempt: 0,
      saveResume: vi.fn().mockResolvedValue(undefined),
    });
    const at = (currentTime: number): MorePlayerMessage => ({
      ...progress("27205", "movie"),
      currentTime,
    });

    session.markLoaded();
    expect(session.getSnapshot().started).toBe(false);
    // A resumed player first reports where it is; that alone is not playback.
    session.handleEvent(at(532));
    session.handleEvent(at(532.2));
    expect(session.getSnapshot().started).toBe(false);
    session.handleEvent(at(532.6));
    expect(session.getSnapshot().started).toBe(true);
    // Pausing later does not undo it.
    session.handleEvent(at(532.6));
    expect(session.getSnapshot().started).toBe(true);
    // Messages for another title never count.
    const other = createMorePlaybackSession({
      tmdbId: 1,
      type: "MOVIE",
      attempt: 0,
      saveResume: vi.fn(),
    });
    other.handleEvent(at(10));
    other.handleEvent(at(20));
    expect(other.getSnapshot().started).toBe(false);
    session.dispose();
    other.dispose();
  });

  it("saves validated progress for the opened TV episode", () => {
    const saveResume = vi.fn().mockResolvedValue(undefined);
    const session = createMorePlaybackSession({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 1,
      attempt: 0,
      saveResume,
    });

    session.handleEvent(progress("93405", "tv", { season: 1, episode: 1 }));

    expect(saveResume).toHaveBeenCalledWith({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 1,
      positionSeconds: 20,
      durationSeconds: 100,
    });
    session.dispose();
  });

  it("ignores mismatched IDs and media types", () => {
    const saveResume = vi.fn();
    const session = createMorePlaybackSession({
      tmdbId: 27205,
      type: "MOVIE",
      attempt: 0,
      saveResume,
    });

    session.handleEvent(progress("1", "movie"));
    session.handleEvent(progress("27205", "tv"));

    expect(saveResume).not.toHaveBeenCalled();
    session.dispose();
  });

  it("follows the player to the next episode and saves progress under it", () => {
    const saveResume = vi.fn().mockResolvedValue(undefined);
    const session = createMorePlaybackSession({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 2,
      attempt: 0,
      saveResume,
    });

    session.handleEvent(progress("93405", "tv", { season: 1, episode: 2 }));
    // The viewer pressed the player's own Next: it now reports episode 3.
    session.handleEvent(progress("93405", "tv", { season: 1, episode: 3 }));

    expect(saveResume.mock.calls.map(([input]) => [input.episode, input.positionSeconds])).toEqual([
      [2, 20],
      [2, 20],
      [3, 20],
    ]);
    expect(session.getSnapshot()).toMatchObject({ season: 1, episode: 3, ended: false });
    // A late "ended" for the episode it left is ignored.
    session.handleEvent({ kind: "ended", id: "93405", mediaType: "tv", season: 1, episode: 2 });
    expect(session.getSnapshot().ended).toBe(false);
    session.dispose();
  });

  it("keeps a finished episode as watched to the end, so the next one is offered", () => {
    const saveResume = vi.fn().mockResolvedValue(undefined);
    const session = createMorePlaybackSession({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 2,
      attempt: 0,
      saveResume,
    });

    session.handleEvent({ ...progress("93405", "tv", { season: 1, episode: 2 }), currentTime: 91 });

    expect(session.getSnapshot().ended).toBe(true);
    expect(saveResume).toHaveBeenLastCalledWith({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 2,
      positionSeconds: 100,
      durationSeconds: 100,
    });
    session.dispose();
  });

  it("offers the next episode only once the episode has played out, not in the credits", () => {
    const session = createMorePlaybackSession({
      tmdbId: 93405,
      type: "TV",
      season: 1,
      episode: 2,
      attempt: 0,
      saveResume: vi.fn().mockResolvedValue(undefined),
    });
    const at = (currentTime: number): MorePlayerMessage => ({
      ...progress("93405", "tv", { season: 1, episode: 2 }),
      currentTime,
    });

    // Credits: watched, but the player's own Next button has the screen to itself.
    session.handleEvent(at(91));
    expect(session.getSnapshot()).toMatchObject({ ended: true, finished: false });
    session.handleEvent(at(98.5));
    expect(session.getSnapshot().finished).toBe(true);

    // The player moved on by itself: the prompt goes with the old episode.
    session.handleEvent({ ...progress("93405", "tv", { season: 1, episode: 3 }), currentTime: 1 });
    expect(session.getSnapshot()).toMatchObject({ episode: 3, ended: false, finished: false });

    // A player that reports the end itself.
    session.handleEvent({ kind: "ended", id: "93405", mediaType: "tv", season: 1, episode: 3 });
    expect(session.getSnapshot().finished).toBe(true);
    session.dispose();
  });

  it("surfaces a failed player server status without raw codes", () => {
    const session = createMorePlaybackSession({
      tmdbId: 550,
      type: "MOVIE",
      attempt: 0,
      saveResume: vi.fn(),
    });

    session.handleEvent({ kind: "status", httpStatus: 200 });
    expect(session.getSnapshot().hasError).toBe(false);

    session.handleEvent({ kind: "status", httpStatus: 500 });
    expect(session.getSnapshot()).toMatchObject({ hasError: true });
    expect(session.getSnapshot().errorMessage).toMatch(/player's servers/i);
    expect(session.getSnapshot().errorMessage).not.toContain("500");
    session.dispose();
  });

  it("ignores events after disposal", () => {
    const saveResume = vi.fn();
    const session = createMorePlaybackSession({
      tmdbId: 27205,
      type: "MOVIE",
      attempt: 0,
      saveResume,
    });
    session.dispose();
    session.handleEvent(progress("27205", "movie"));
    expect(saveResume).not.toHaveBeenCalled();
  });
});

describe("readMorePlayerMessage", () => {
  const frame = {} as Window;
  const data = {
    type: "PLAYER_EVENT",
    data: { event: "timeupdate", currentTime: 5, duration: 50, tmdbId: 27205, mediaType: "movie" },
  };
  const read = (overrides: Partial<Parameters<typeof readMorePlayerMessage>[0]>) =>
    readMorePlayerMessage({
      data,
      origin: "https://more.example",
      source: frame,
      playerOrigin: "https://more.example",
      frameWindow: frame,
      ...overrides,
    });

  it("accepts a valid message from the exact player origin and active frame", () => {
    expect(read({})).toMatchObject({ kind: "progress", id: "27205", currentTime: 5 });
  });

  it("ignores other origins, other windows, a missing frame, and malformed payloads", () => {
    expect(read({ origin: "https://more-alias.example" })).toBeUndefined();
    expect(read({ origin: "http://127.0.0.1:5173" })).toBeUndefined();
    expect(read({ source: {} as Window })).toBeUndefined();
    expect(read({ frameWindow: null, source: null })).toBeUndefined();
    expect(read({ data: { type: "PLAYER_EVENT", data: [] } })).toBeUndefined();
  });
});
