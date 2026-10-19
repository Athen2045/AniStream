import { describe, expect, it, vi } from "vitest";
import { parseSkipTimes, SkipTimesClient } from "../../src/main/skip-times";

const FRIEREN_E1 = {
  found: true,
  results: [
    {
      interval: { startTime: 3.221, endTime: 93.221 },
      skipType: "op",
      skipId: "c2cacbe5",
      episodeLength: 1559.949,
    },
    {
      interval: { startTime: 1417.135, endTime: 1507.135 },
      skipType: "ed",
      skipId: "92965d0e",
      episodeLength: 1510.102,
    },
  ],
  message: "Successfully found skip times",
  statusCode: 200,
};

const input = { aniListId: 154587, malId: 52991, episode: 1, durationSeconds: 1559.9 };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("parseSkipTimes", () => {
  it("keeps one opening and one ending, clamped to the stream", () => {
    expect(parseSkipTimes(FRIEREN_E1, 1500)).toEqual([
      { kind: "opening", start: 3.221, end: 93.221 },
      { kind: "ending", start: 1417.135, end: 1500 },
    ]);
  });

  it("drops malformed, tiny and unknown rows", () => {
    expect(
      parseSkipTimes(
        {
          results: [
            null,
            { skipType: "recap", interval: { startTime: 0, endTime: 60 } },
            { skipType: "op", interval: { startTime: "3", endTime: 90 } },
            { skipType: "op", interval: { startTime: 10, endTime: 14 } },
            { skipType: "op", interval: { startTime: 20, endTime: 110 } },
            { skipType: "op", interval: { startTime: 30, endTime: 120 } },
          ],
        },
        1440,
      ),
    ).toEqual([{ kind: "opening", start: 20, end: 110 }]);
    expect(parseSkipTimes("nope", 1440)).toEqual([]);
    expect(parseSkipTimes({ results: "nope" }, 1440)).toEqual([]);
  });
});

describe("SkipTimesClient", () => {
  it("asks with the MAL id, episode and rounded length, then caches", async () => {
    const fetcher = vi.fn(async () => json(FRIEREN_E1));
    const client = new SkipTimesClient("https://skip.example/v2", fetcher as typeof fetch);
    const first = await client.getSkipTimes(input);
    const second = await client.getSkipTimes(input);
    expect(first).toHaveLength(2);
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/v2/skip-times/52991/1");
    expect(url.searchParams.getAll("types[]")).toEqual(["op", "ed"]);
    expect(url.searchParams.get("episodeLength")).toBe("1560");
  });

  it("treats AniSkip's 404 as no times", async () => {
    const fetcher = vi.fn(async () => json({ found: false, results: [] }, 404));
    const client = new SkipTimesClient("https://skip.example/v2", fetcher as typeof fetch);
    await expect(client.getSkipTimes(input)).resolves.toEqual([]);
  });

  it("stops asking after a 429 until Retry-After passes", async () => {
    let now = 1_000_000;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "30" }))
      .mockResolvedValue(json(FRIEREN_E1));
    const client = new SkipTimesClient(
      "https://skip.example/v2",
      fetcher as unknown as typeof fetch,
      () => now,
    );
    await expect(client.getSkipTimes(input)).rejects.toThrow();
    await expect(client.getSkipTimes(input)).rejects.toThrow("paused");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 31_000;
    await expect(client.getSkipTimes(input)).resolves.toHaveLength(2);
  });

  it("rejects a server error without caching it", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValue(json(FRIEREN_E1));
    const client = new SkipTimesClient(
      "https://skip.example/v2",
      fetcher as unknown as typeof fetch,
    );
    await expect(client.getSkipTimes(input)).rejects.toThrow("500");
    await expect(client.getSkipTimes(input)).resolves.toHaveLength(2);
  });
});
