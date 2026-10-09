import { describe, expect, it, vi } from "vitest";
import { createMorePlayerLoadGuard } from "../../src/renderer/src/more-player-load-guard";

describe("More player load guard", () => {
  it("reports a player that never loads", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createMorePlayerLoadGuard(onTimeout, 20);

    guard.start();
    vi.advanceTimersByTime(21);

    expect(onTimeout).toHaveBeenCalledOnce();
    guard.dispose();
    vi.useRealTimers();
  });

  it("cancels the timeout after the iframe loads", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createMorePlayerLoadGuard(onTimeout, 20);

    guard.start();
    guard.markLoaded();
    vi.advanceTimersByTime(21);

    expect(onTimeout).not.toHaveBeenCalled();
    guard.dispose();
    vi.useRealTimers();
  });
});
