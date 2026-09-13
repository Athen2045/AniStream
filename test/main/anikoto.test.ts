import { describe, expect, it, vi } from "vitest";
import {
  AnikotoClient,
  findExactRecentAniListSeries,
  parseAnikotoSeriesCatalog,
} from "../../src/main/anikoto";

describe("Anikoto response normalization", () => {
  it("finds one exact numeric AniList mapping without title guessing", () => {
    expect(
      findExactRecentAniListSeries(
        {
          data: [
            { id: 8868, ani_id: "194829", title: "Master Swordsman Season 2" },
            { id: 2, ani_id: "1", title: "Another show" },
          ],
        },
        194829,
      ),
    ).toEqual({
      id: 8868,
      aniListId: 194829,
      title: "Master Swordsman Season 2",
    });
  });

  it("rejects ambiguous AniList mappings", () => {
    expect(
      findExactRecentAniListSeries(
        {
          data: [
            { id: 1, ani_id: "194829", title: "Duplicate A" },
            { id: 2, ani_id: "194829", title: "Duplicate B" },
          ],
        },
        194829,
      ),
    ).toBeUndefined();
  });

  it("normalizes exact series episodes and rejects mismatched identities", () => {
    const payload = {
      ok: true,
      data: {
        anime: {
          ani_id: "194829",
          title: "Master Swordsman Season 2",
          background_image: "https://art.example/background.webp",
        },
        episodes: [
          { number: 2, title: "Episode 2", episode_embed_id: "803762" },
          { number: 1, title: "Episode 1", episode_embed_id: "775493" },
          { number: 3, title: "Unsafe", episode_embed_id: "../escape" },
        ],
      },
    };

    const result = parseAnikotoSeriesCatalog(payload, {
      aniListId: 194829,
      titles: ["Master Swordsman Season 2"],
      seasonLabel: "Summer 2026",
    });
    expect(result.status).toBe("available");
    expect(result.provider).toBe("anikoto");
    expect(result.seasons[0]?.episodes).toMatchObject([
      { id: "anikoto:775493", number: 1, title: "Episode 1" },
      { id: "anikoto:803762", number: 2, title: "Episode 2" },
    ]);

    expect(
      parseAnikotoSeriesCatalog(payload, {
        aniListId: 1,
        titles: ["Wrong show"],
      }).status,
    ).toBe("unavailable");
  });

  it("decodes HTML entities in provider episode titles and summaries", () => {
    const result = parseAnikotoSeriesCatalog(
      {
        ok: true,
        data: {
          anime: { ani_id: "194829", title: "One Piece" },
          episodes: [
            {
              number: 1,
              title: "I&#39;m Luffy! The Man Who&#39;s Gonna Be King &amp; Pirate!",
              description: "A &quot;great&quot; adventure &mdash; begins.",
              episode_embed_id: "775493",
            },
          ],
        },
      },
      { aniListId: 194829, titles: ["One Piece"] },
    );

    expect(result.seasons[0]?.episodes[0]).toMatchObject({
      title: "I'm Luffy! The Man Who's Gonna Be King & Pirate!",
      description: 'A "great" adventure — begins.',
    });
  });
});

describe("Anikoto client", () => {
  it("checks readiness through the cached recent index", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, data: [] }));
    const client = new AnikotoClient(fetcher as typeof fetch);

    await expect(client.checkReadiness()).resolves.toMatchObject({
      provider: "anikoto",
      status: "ready",
    });
    await expect(client.checkReadiness()).resolves.toMatchObject({ status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports malformed readiness data without retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: null }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    const client = new AnikotoClient(fetcher as typeof fetch);

    await expect(client.checkReadiness()).resolves.toMatchObject({
      provider: "anikoto",
      status: "unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client.checkReadiness()).resolves.toMatchObject({ status: "ready" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("distinguishes offline and rate-limited readiness failures", async () => {
    const offline = new AnikotoClient(
      vi.fn(async () => {
        throw new TypeError("fetch failed: ENOTFOUND");
      }) as unknown as typeof fetch,
    );
    const limited = new AnikotoClient(
      vi.fn(async () => jsonResponse({ ok: false }, 429, { "Retry-After": "0" })) as typeof fetch,
    );

    await expect(offline.checkReadiness()).resolves.toMatchObject({ status: "offline" });
    await expect(limited.checkReadiness()).resolves.toMatchObject({ status: "rate-limited" });
  });

  it("loads recent mapping then the exact series", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/recent-anime")) {
        return jsonResponse({
          ok: true,
          data: [{ id: 8868, ani_id: "194829", title: "Master Swordsman Season 2" }],
        });
      }
      return jsonResponse({
        ok: true,
        data: {
          anime: { ani_id: "194829", title: "Master Swordsman Season 2" },
          episodes: [{ number: 1, title: "Episode 1", episode_embed_id: "775493" }],
        },
      });
    });
    const client = new AnikotoClient(fetcher as typeof fetch);

    const catalog = await client.getEpisodeCatalog({
      aniListId: 194829,
      titles: ["Master Swordsman Season 2"],
      totalEpisodes: 12,
    });

    expect(catalog.status).toBe("available");
    expect(catalog.seasons[0]?.episodes[0]?.id).toBe("anikoto:775493");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent catalog requests for the same title", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      await Promise.resolve();
      if (String(input).includes("/recent-anime")) {
        return jsonResponse({
          ok: true,
          data: [{ id: 8868, ani_id: "194829", title: "Master Swordsman Season 2" }],
        });
      }
      return jsonResponse({
        ok: true,
        data: {
          anime: { ani_id: "194829", title: "Master Swordsman Season 2" },
          episodes: [{ number: 1, title: "Episode 1", episode_embed_id: "775493" }],
        },
      });
    });
    const client = new AnikotoClient(fetcher as typeof fetch);
    const input = {
      aniListId: 194829,
      titles: ["Master Swordsman Season 2"],
      totalEpisodes: 12,
    };

    const [first, second] = await Promise.all([
      client.getEpisodeCatalog(input),
      client.getEpisodeCatalog(input),
    ]);

    // Each caller normalizes the shared provider response independently.
    const { checkedAt: firstCheckedAt, ...firstCatalog } = first;
    const { checkedAt: secondCheckedAt, ...secondCatalog } = second;
    expect(firstCatalog).toEqual(secondCatalog);
    expect(new Date(firstCheckedAt).toISOString()).toBe(firstCheckedAt);
    expect(new Date(secondCheckedAt).toISOString()).toBe(secondCheckedAt);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses the documented direct AniList route when no catalog mapping is available", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, data: [] }));
    const client = new AnikotoClient(fetcher as typeof fetch);

    const catalog = await client.getEpisodeCatalog({
      aniListId: 170942,
      titles: ["Blue Box"],
      totalEpisodes: 2,
    });
    const playback = await client.getPlayback({
      aniListId: 170942,
      title: "Blue Box",
      episode: 2,
    });

    expect(catalog.seasons[0]?.episodes).toHaveLength(2);
    expect(catalog.message).toContain("does not publish a full-catalog search endpoint");
    expect(playback.candidates[0]?.url).toBe("https://megaplay.buzz/stream/ani/170942/2/sub");
    expect(playback.candidates.every((candidate) => candidate.kind === "embed")).toBe(true);
  });

  it("prefers the documented episode-ID route when Anikoto supplied an embed ID", async () => {
    const client = new AnikotoClient(vi.fn() as unknown as typeof fetch);
    const playback = await client.getPlayback({
      aniListId: 194829,
      title: "Master Swordsman Season 2",
      episode: 1,
      providerEpisodeId: "anikoto:775493",
      audio: "dub",
    });
    expect(playback.candidates[0]).toMatchObject({
      language: "dub",
      url: "https://megaplay.buzz/stream/s-2/775493/dub",
    });
  });

  it("does not retry 429 responses and keeps the AniList episode list available", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: false }, 429, { "Retry-After": "0" }));
    const client = new AnikotoClient(fetcher as typeof fetch);
    const catalog = await client.getEpisodeCatalog({
      aniListId: 170942,
      titles: ["Blue Box"],
      totalEpisodes: 25,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(catalog.status).toBe("available");
    expect(catalog.seasons[0]?.episodes).toHaveLength(25);
    expect(catalog.message).toContain("rate limit");
  });

  it("reports an injected timeout as playback-only degradation", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const client = new AnikotoClient(fetcher as unknown as typeof fetch);
    const catalog = await client.getEpisodeCatalog({
      aniListId: 170942,
      titles: ["Blue Box"],
      totalEpisodes: 1,
    });

    expect(catalog.status).toBe("available");
    expect(catalog.message).toContain("timed out");
  });
});

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
