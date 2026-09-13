import { describe, expect, it, vi } from "vitest";
import { createDiscoverySession } from "../../src/renderer/src/discovery-session";
import type { DiscoveryFeed } from "../../src/shared/discovery";
const item = {
  anilistId: 10,
  mediaType: "ANIME" as const,
  title: "Real title",
  score: 45,
  reasonCodes: [],
};
const feed: DiscoveryFeed = { status: "ready", requestId: "feed-1", items: [item] };
const bridge = () => ({
  getForYou: vi.fn(async (): Promise<DiscoveryFeed> => feed),
  recordDiscoveryFeedback: vi.fn(async () => undefined),
  recordDiscoveryImpressions: vi.fn(async () => undefined),
});
describe("For You renderer session", () => {
  it("deduplicates refresh triggers while one request is still running", async () => {
    const api = bridge();
    let finish: (value: DiscoveryFeed) => void = () => undefined;
    api.getForYou.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const session = createDiscoverySession("ANIME", api);
    const first = session.load();
    const second = session.load();
    expect(api.getForYou).toHaveBeenCalledOnce();
    finish(feed);
    await Promise.all([first, second]);
    expect(session.getSnapshot()).toMatchObject({ loading: false, feed });
  });
  it("ends a stalled refresh with a useful message and retains prior suggestions", async () => {
    vi.useFakeTimers();
    try {
      const api = bridge();
      const session = createDiscoverySession("ANIME", api, { requestTimeoutMs: 1_000 });
      await session.load();
      api.getForYou.mockReturnValueOnce(new Promise(() => undefined));
      const pending = session.load();
      await vi.advanceTimersByTimeAsync(1_001);
      await pending;
      expect(session.getSnapshot().loading).toBe(false);
      expect(session.getSnapshot().feed).toEqual(feed);
      expect(session.getSnapshot().error).toMatch(/taking longer|previous suggestions/i);
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not let disposed feedback overwrite a reactivated session", async () => {
    const api = bridge();
    const session = createDiscoverySession("ANIME", api);
    await session.load();
    let fail: (reason: Error) => void = () => undefined;
    api.recordDiscoveryFeedback.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const pending = session.dismiss(item);
    session.dispose();
    session.activate();
    await session.load();
    fail(new Error("Late disk failure"));
    await pending;
    expect(session.getSnapshot().busy).toBe(false);
    expect(session.getSnapshot().error).toBeUndefined();
    expect(session.getSnapshot().feed?.items).toEqual([item]);
  });
  it("retains useful results on failure and does not count fetching as visibility", async () => {
    const api = bridge();
    const session = createDiscoverySession("ANIME", api);
    await session.load();
    expect(api.recordDiscoveryImpressions).not.toHaveBeenCalled();
    api.getForYou.mockResolvedValueOnce({
      status: "unavailable",
      items: [],
      message: "429, try later",
    });
    await session.load();
    expect(session.getSnapshot().feed).toEqual(feed);
    expect(session.getSnapshot().error).toMatch(/busy|try again/i);
    await session.visible(item);
    await session.visible(item);
    expect(api.recordDiscoveryImpressions).toHaveBeenCalledOnce();
  });
  it("does not hide failed feedback and supports a successful dismiss/undo", async () => {
    const api = bridge();
    const session = createDiscoverySession("ANIME", api);
    await session.load();
    api.recordDiscoveryFeedback.mockRejectedValueOnce(new Error("disk full"));
    await session.dismiss(item);
    expect(session.getSnapshot().feed?.items).toHaveLength(1);
    expect(session.getSnapshot().error).toContain("unchanged");
    await session.dismiss(item);
    expect(session.getSnapshot().feed?.items).toEqual([]);
    await session.undo();
    expect(session.getSnapshot().feed?.items).toEqual([item]);
    expect(api.recordDiscoveryFeedback.mock.lastCall?.[0]).toMatchObject({
      action: "undo",
      requestId: "feed-1",
    });
  });
  it("ignores stale loads after feedback or disposal and can activate after strict effect cleanup", async () => {
    const api = bridge();
    const session = createDiscoverySession("ANIME", api);
    await session.load();
    let finish: (feed: DiscoveryFeed) => void = () => undefined;
    api.getForYou.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = session.load();
    await session.dismiss(item);
    finish(feed);
    await pending;
    expect(session.getSnapshot().feed?.items).toEqual([]);
    session.dispose();
    session.activate();
    await session.load();
    expect(session.getSnapshot().feed?.items).toEqual([item]);
  });
});
