import { describe, expect, it, vi } from "vitest";
import type { DiscoveryFeed } from "../../src/shared/discovery";
import type { RecommendationResult } from "../../src/shared/recommendations";
import {
  ForYouUnavailableError,
  forYouQuery,
  withoutForYouTitle,
} from "../../src/renderer/src/for-you-queries";
import { createAppQueryClient } from "../../src/renderer/src/query-client";

function pick(anilistId: number): RecommendationResult {
  return { anilistId, mediaType: "ANIME", title: `Title ${anilistId}`, score: 1, reasonCodes: [] };
}

const ready = (requestId: string, ids = [1, 2]): DiscoveryFeed => ({
  status: "ready",
  requestId,
  items: ids.map(pick),
});

describe("forYouQuery", () => {
  it("may use the saved feed first and asks for a rebuild once a feed is shown", async () => {
    const api = {
      getForYou: vi.fn(async (_type: string, fresh?: boolean) =>
        ready(fresh ? "rebuilt" : "saved"),
      ),
    };
    const client = createAppQueryClient();
    const options = forYouQuery("ANIME", "guest", api);

    await client.fetchQuery(options);
    await client.refetchQueries({ queryKey: options.queryKey });

    expect(api.getForYou.mock.calls).toEqual([
      ["ANIME", false],
      ["ANIME", true],
    ]);
    expect(client.getQueryData(options.queryKey)?.requestId).toBe("rebuilt");
  });

  it("asks once while a load is still running", async () => {
    let finish!: (feed: DiscoveryFeed) => void;
    const api = { getForYou: vi.fn(() => new Promise<DiscoveryFeed>((done) => (finish = done))) };
    const client = createAppQueryClient();
    const options = forYouQuery("MANGA", "42", api);

    const first = client.fetchQuery(options);
    const second = client.fetchQuery(options);
    finish(ready("one"));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(api.getForYou).toHaveBeenCalledTimes(1);
  });

  it("ends a stalled rebuild and keeps the suggestions already shown", async () => {
    const api = {
      getForYou: vi
        .fn<(type: string, fresh?: boolean) => Promise<DiscoveryFeed>>()
        .mockResolvedValueOnce(ready("first"))
        .mockImplementation(() => new Promise<DiscoveryFeed>(() => undefined)),
    };
    const client = createAppQueryClient();
    const options = forYouQuery("ANIME", "guest", api, 20);

    await client.fetchQuery(options);
    await client.refetchQueries({ queryKey: options.queryKey });

    const state = client.getQueryState(options.queryKey);
    expect(state?.error?.name).toBe("TimeoutError");
    expect(state?.data?.requestId).toBe("first");
  });

  it("keeps shown suggestions when AniList answers unavailable", async () => {
    const api = {
      getForYou: vi
        .fn<(type: string, fresh?: boolean) => Promise<DiscoveryFeed>>()
        .mockResolvedValueOnce(ready("first"))
        .mockResolvedValue({ status: "unavailable", items: [], message: "AniList is down." }),
    };
    const client = createAppQueryClient();
    const options = forYouQuery("ANIME", "guest", api);

    await client.fetchQuery(options);
    await client.refetchQueries({ queryKey: options.queryKey });

    const state = client.getQueryState(options.queryKey);
    expect(state?.error).toBeInstanceOf(ForYouUnavailableError);
    expect(state?.data?.requestId).toBe("first");
  });

  it("shows AniList's unavailable answer when nothing was shown yet", async () => {
    const unavailable: DiscoveryFeed = { status: "unavailable", items: [], message: "Down." };
    const api = { getForYou: vi.fn(async () => unavailable) };
    await expect(
      createAppQueryClient().fetchQuery(forYouQuery("ANIME", "guest", api)),
    ).resolves.toEqual(unavailable);
  });
});

describe("withoutForYouTitle", () => {
  it("removes a dismissed title from the main rail and every row", () => {
    const feed: DiscoveryFeed = {
      ...ready("feed", [1, 2]),
      rows: [{ seedId: 9, seedTitle: "Seed", items: [pick(2), pick(3)] }],
    };
    const next = withoutForYouTitle(feed, 2);
    expect(next.items.map((item) => item.anilistId)).toEqual([1]);
    expect(next.rows?.[0]?.items.map((item) => item.anilistId)).toEqual([3]);
  });
});
