import { describe, expect, it, vi } from "vitest";
import { AuthorizationTransaction } from "../../src/main/anilist/authorization-transaction";

describe("AuthorizationTransaction", () => {
  it("times out and aborts an unfinished browser authorization", async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const transaction = new AuthorizationTransaction({ timeoutMs: 30_000, onTimeout });
      const signal = transaction.begin();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(signal.aborted).toBe(true);
      expect(transaction.active).toBe(false);
      expect(onTimeout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes one callback and ignores callbacks outside the active transaction", async () => {
    const transaction = new AuthorizationTransaction({ timeoutMs: 30_000, onTimeout: vi.fn() });
    expect(await transaction.handleCallback(async () => "ignored")).toEqual({ handled: false });

    transaction.begin();
    const first = transaction.handleCallback(async (signal) => {
      expect(signal.aborted).toBe(false);
      return "token";
    });
    const duplicate = await transaction.handleCallback(async () => "duplicate");

    await expect(first).resolves.toEqual({ handled: true, value: "token" });
    expect(duplicate).toEqual({ handled: false });
    expect(transaction.active).toBe(false);
  });

  it("supports explicit cancellation", () => {
    const transaction = new AuthorizationTransaction({ timeoutMs: 30_000, onTimeout: vi.fn() });
    const signal = transaction.begin();

    expect(transaction.cancel()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(transaction.cancel()).toBe(false);
  });
});
