import { describe, expect, it, vi } from "vitest";
import {
  chooseInitialAnimeEpisode,
  createAnimePlaybackSession,
} from "../../src/renderer/src/anime-playback-session";

const ORIGIN = "https://megaplay.buzz";

describe("AnimePlaybackSession", () => {
  it("never lets a stale checkpoint undercut the requested Continue episode", () => {
    expect(
      chooseInitialAnimeEpisode({
        requestedEpisode: 5,
        savedEpisode: 1,
        completedProgress: 0,
        totalEpisodes: 12,
      }),
    ).toBe(5);
  });
  it("accepts a bare provider error only from the active trusted frame and recovers on progress", () => {
    const session = createAnimePlaybackSession({
      mediaId: 189046,
      episode: 1,
      saveResume: vi.fn(),
      clearResume: vi.fn(),
      onWatched: vi.fn(),
    });
    const frame = {} as Window;
    session.handleMessage({ event: "error" }, "https://example.com", frame, frame);
    session.handleMessage({ event: "error" }, ORIGIN, {}, frame);
    expect(session.getSnapshot().hasError).toBe(false);
    session.handleMessage({ event: "error" }, ORIGIN, frame, frame);
    expect(session.getSnapshot()).toMatchObject({ hasError: true, hasProgressed: false });
    expect(session.getSnapshot().errorMessage).toBeTruthy();
    session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, frame, frame);
    expect(session.getSnapshot()).toMatchObject({ hasError: false, hasProgressed: true });
    session.dispose();
  });
  it("reactivates the timeout and accepts trusted playback after development cleanup", () => {
    vi.useFakeTimers();
    try {
      const session = createAnimePlaybackSession({
        mediaId: 42,
        episode: 3,
        saveResume: vi.fn(),
        clearResume: vi.fn(),
        onWatched: vi.fn(),
        loadTimeoutMs: 20,
      });
      session.dispose();
      session.activate();
      session.markLoaded();
      vi.advanceTimersByTime(21);
      expect(session.getSnapshot().loadTimedOut).toBe(true);
      const frame = {} as Window;
      session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, frame, frame);
      expect(session.getSnapshot()).toMatchObject({
        loaded: true,
        hasProgressed: true,
        loadTimedOut: false,
      });
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("times out a loaded frame without playback and recovers on a late trusted event", () => {
    vi.useFakeTimers();
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume: () => undefined,
      clearResume: () => undefined,
      onWatched: () => undefined,
      loadTimeoutMs: 20,
    });
    const frame = {} as Window;
    session.markLoaded();
    vi.advanceTimersByTime(21);
    expect(session.getSnapshot().loadTimedOut).toBe(true);
    session.handleMessage({ event: "time", time: 20, duration: 100 }, ORIGIN, frame, frame);
    expect(session.getSnapshot()).toMatchObject({
      loadTimedOut: false,
      hasProgressed: true,
      hasError: false,
    });
    session.dispose();
    vi.useRealTimers();
  });
  it("preserves completion for retry when durable saving fails and clears only after saving", async () => {
    let fail = true;
    const saved: string[] = [];
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume: () => undefined,
      clearResume: () => {
        saved.push("clear");
      },
      onWatched: async () => {
        if (fail) throw new Error("disk full");
        saved.push("journal");
      },
    });
    const frame = {} as Window;
    session.handleMessage({ event: "complete" }, ORIGIN, frame, frame);
    await vi.waitFor(() => expect(session.getSnapshot().persistenceError).toContain("disk full"));
    expect(saved).toEqual([]);
    fail = false;
    session.retryPersistence();
    await vi.waitFor(() => expect(saved).toEqual(["journal", "clear"]));
    expect(session.getSnapshot().persistenceError).toBeUndefined();
    session.dispose();
  });
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

  it("flushes the latest progress on dispose and clears completed resume", async () => {
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
    await vi.waitFor(() => expect(clearResume).toHaveBeenCalledWith(42));
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

  it("replaces opaque MegaPlay provider errors with recovery guidance", () => {
    const session = createAnimePlaybackSession({
      mediaId: 42,
      episode: 3,
      saveResume: vi.fn(),
      clearResume: vi.fn(),
      onWatched: vi.fn(),
    });
    const frame = {} as Window;

    session.handleMessage(
      { event: "error", message: "Provider error 233403" },
      ORIGIN,
      frame,
      frame,
    );

    expect(session.getSnapshot().errorMessage).toBe(
      "This episode is unavailable from the player right now. Try another audio option or episode.",
    );
    session.dispose();
  });
});
