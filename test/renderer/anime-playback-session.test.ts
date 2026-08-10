import { describe, expect, it, vi } from "vitest";
import { createAnimePlaybackSession } from "../../src/renderer/src/anime-playback-session";

const ORIGIN = "https://megaplay.buzz";

describe("AnimePlaybackSession", () => {
  it("accepts progress only from the expected MegaPlay frame", () => {
    const saveResume = vi.fn();
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume,
      clearResume: vi.fn(),
      onWatched: vi.fn(),
      now: () => 20_000,
    });
    const frame = {} as Window;

    session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, {}, frame);
    expect(saveResume).not.toHaveBeenCalled();

    session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, frame, frame);
    expect(saveResume).toHaveBeenCalledWith({
      aniListId: 42,
      episode: 3,
      positionSeconds: 20,
      durationSeconds: 100,
    });

    session.dispose();
  });

  it("flushes the latest progress on dispose and clears completed resume", () => {
    let now = 20_000;
    const saveResume = vi.fn();
    const clearResume = vi.fn();
    const onWatched = vi.fn();
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume,
      clearResume,
      onWatched,
      now: () => now,
    });
    const frame = {} as Window;

    session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, frame, frame);
    now += 11_000;
    session.handleMessage({ event: "time", time: 40, duration: 100 }, ORIGIN, frame, frame);
    expect(saveResume).toHaveBeenCalledTimes(2);

    session.dispose();
    expect(saveResume).toHaveBeenCalledTimes(3);

    const completed = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume: vi.fn(),
      clearResume,
      onWatched,
      now: () => now,
    });
    completed.handleMessage({ event: "time", time: 90, duration: 100 }, ORIGIN, frame, frame);
    expect(clearResume).toHaveBeenCalledWith(42);
    expect(onWatched).toHaveBeenCalledWith(3);
    completed.dispose();
  });

  it("surfaces completion and provider errors as session state", () => {
    const onWatched = vi.fn();
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume: vi.fn(),
      clearResume: vi.fn(),
      onWatched,
      now: () => 20_000,
    });
    const frame = {} as Window;

    session.handleMessage({ event: "complete" }, ORIGIN, frame, frame);
    expect(session.getSnapshot()).toMatchObject({ ended: true, hasProgressed: false });
    expect(onWatched).toHaveBeenCalledWith(3);

    session.handleMessage(
      { event: "error", message: "Provider unavailable" },
      ORIGIN,
      frame,
      frame,
    );
    expect(session.getSnapshot()).toMatchObject({ hasError: true });

    session.dispose();
  });
});
