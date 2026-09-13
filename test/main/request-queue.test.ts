import { describe, expect, it, vi } from "vitest";
import { createRequestGate } from "../../src/main/anilist/request-queue";

describe("createRequestGate", () => {
  it("deduplicates concurrent calls sharing a dedupe key", async () => {
    const gate = createRequestGate({ requestsPerMinute: 25 });
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    const [a, b] = await Promise.all([gate.run("same-key", fn), gate.run("same-key", fn)]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("never merges calls with no dedupe key", async () => {
    const gate = createRequestGate({ requestsPerMinute: 25 });
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    await Promise.all([gate.run(undefined, fn), gate.run(undefined, fn)]);

    expect(calls).toBe(2);
  });

  it("allows a fresh dedupe key to run again once the prior call resolved", async () => {
    const gate = createRequestGate({ requestsPerMinute: 25 });
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    await gate.run("key", fn);
    await gate.run("key", fn);

    expect(calls).toBe(2);
  });

  it("clears a rejected deduplicated call without creating an unhandled cleanup rejection", async () => {
    const gate = createRequestGate({ requestsPerMinute: 25 });
    let calls = 0;

    await expect(
      gate.run("recoverable-key", async () => {
        calls += 1;
        throw new Error("provider unavailable");
      }),
    ).rejects.toThrow("provider unavailable");

    await expect(
      gate.run("recoverable-key", async () => {
        calls += 1;
        return "recovered";
      }),
    ).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });

  it("throttles starts to the configured limit within the window", async () => {
    vi.useFakeTimers();
    try {
      const gate = createRequestGate({ requestsPerMinute: 2, windowMs: 1_000 });
      const starts: number[] = [];
      const fn = async (): Promise<void> => {
        starts.push(Date.now());
      };

      const runs = [gate.run(undefined, fn), gate.run(undefined, fn), gate.run(undefined, fn)];
      await vi.advanceTimersByTimeAsync(0);
      expect(starts.length).toBe(2);

      await vi.advanceTimersByTimeAsync(1_001);
      await Promise.all(runs);

      expect(starts.length).toBe(3);
      expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces request starts to avoid an undocumented provider burst limiter", async () => {
    vi.useFakeTimers();
    try {
      const gate = createRequestGate({ requestsPerMinute: 25, minIntervalMs: 350 });
      const starts: number[] = [];
      const runs = [
        gate.run(undefined, async () => starts.push(Date.now())),
        gate.run(undefined, async () => starts.push(Date.now())),
      ];

      await vi.advanceTimersByTimeAsync(0);
      expect(starts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(349);
      expect(starts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all(runs);
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses every future request after reportRateLimited until the duration elapses", async () => {
    vi.useFakeTimers();
    try {
      const gate = createRequestGate({ requestsPerMinute: 25 });
      const starts: number[] = [];
      const fn = async (): Promise<void> => {
        starts.push(Date.now());
      };

      gate.reportRateLimited(5_000);
      const run = gate.run(undefined, fn);
      await vi.advanceTimersByTimeAsync(0);
      expect(starts.length).toBe(0);

      await vi.advanceTimersByTimeAsync(5_001);
      await run;
      expect(starts.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only ever extends an existing pause, never shortens it", async () => {
    vi.useFakeTimers();
    try {
      const gate = createRequestGate({ requestsPerMinute: 25 });
      const starts: number[] = [];
      const fn = async (): Promise<void> => {
        starts.push(Date.now());
      };

      gate.reportRateLimited(10_000);
      gate.reportRateLimited(2_000);
      const run = gate.run(undefined, fn);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(starts.length).toBe(0);

      await vi.advanceTimersByTimeAsync(7_001);
      await run;
      expect(starts.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels queued work before it consumes a provider slot", async () => {
    vi.useFakeTimers();
    try {
      const gate = createRequestGate({ requestsPerMinute: 25 });
      const controller = new AbortController();
      const fn = vi.fn(async () => "unexpected");
      gate.reportRateLimited(10_000);

      const run = gate.run(undefined, fn, controller.signal);
      const assertion = expect(run).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);

      await assertion;
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
