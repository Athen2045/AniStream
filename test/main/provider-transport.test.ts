import { describe, expect, it, vi } from "vitest";
import { createRequestGate } from "../../src/main/anilist/request-queue";
import { ProviderTransport, mapSettledWithConcurrency } from "../../src/main/provider-transport";

describe("ProviderTransport", () => {
  it("applies common headers and keeps provider response policy at the adapter edge", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("User-Agent")).toBe("AniStream/test");
      expect(new Headers(init?.headers).get("X-Provider")).toBe("manga");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const transport = new ProviderTransport({
      fetcher,
      gate: createRequestGate({ requestsPerMinute: 10 }),
      timeoutMs: 1_000,
      headers: { Accept: "application/json", "User-Agent": "AniStream/test" },
    });

    await expect(
      transport.requestJson(new URL("https://example.com/manga"), {
        headers: { "X-Provider": "manga" },
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("aborts before dispatch when the caller cancels queued work", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const gate = createRequestGate({ requestsPerMinute: 10 });
    gate.reportRateLimited(60_000);
    const transport = new ProviderTransport({ fetcher, gate, timeoutMs: 1_000 });
    const controller = new AbortController();
    const request = transport.request(new URL("https://example.com"), {
      signal: controller.signal,
    });
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();

    await assertion;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("includes rate-limit queue time in the provider deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>();
      const gate = createRequestGate({ requestsPerMinute: 10 });
      gate.reportRateLimited(60_000);
      const transport = new ProviderTransport({ fetcher, gate, timeoutMs: 1_000 });
      const request = transport.request(new URL("https://example.com"));
      const assertion = expect(request).rejects.toMatchObject({ name: "TimeoutError" });

      await vi.advanceTimersByTimeAsync(1_001);

      await assertion;
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an already-aborted caller reason", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = new ProviderTransport({
      fetcher,
      gate: createRequestGate({ requestsPerMinute: 10 }),
      timeoutMs: 1_000,
    });
    const controller = new AbortController();
    const reason = new DOMException("Title closed.", "AbortError");
    controller.abort(reason);

    await expect(
      transport.request(new URL("https://example.com/title"), {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels safely when Electron dispatches an abort event with no currentTarget", async () => {
    let fireCallerAbort: (() => void) | undefined;
    const reason = new DOMException("Title closed.", "AbortError");
    const callerSignal = {
      aborted: false,
      reason,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        fireCallerAbort = () => {
          const callback =
            typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
          callback(new Event("abort"));
        };
      },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const fetcher = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const transport = new ProviderTransport({
      fetcher,
      gate: createRequestGate({ requestsPerMinute: 10 }),
      timeoutMs: 1_000,
    });

    const request = transport.request(new URL("https://example.com/title"), {
      signal: callerSignal,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    expect(() => fireCallerAbort?.()).not.toThrow();
    await expect(request).rejects.toBe(reason);
  });
});

describe("mapSettledWithConcurrency", () => {
  it("bounds fan-out and preserves successful batches around a failed one", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapSettledWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (value === 2) throw new Error("batch failed");
      return value * 2;
    });

    expect(maxActive).toBe(2);
    expect(
      results.filter((result) => result.status === "fulfilled").map((result) => result.value),
    ).toEqual([2, 6, 8]);
  });
});
