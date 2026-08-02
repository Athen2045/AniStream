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
