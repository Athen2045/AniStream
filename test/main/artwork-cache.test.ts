import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtworkCache } from "../../src/main/artwork-cache";
import {
  artworkSourceFromCacheUrl,
  cachedArtworkUrl,
  isCacheableArtworkUrl,
} from "../../src/shared/artwork";

const banner = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg";
const directories: string[] = [];

async function cache(fetchImpl: typeof fetch, options: { maxFiles?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anistream-art-"));
  directories.push(directory);
  return {
    directory,
    cache: new ArtworkCache({ directory, userAgent: "test", fetch: fetchImpl, ...options }),
  };
}

function image(type = "image/jpeg"): Response {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type } });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("offline artwork cache", () => {
  it("keeps a local copy that still serves when the network is down", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(image());
    const { cache: artwork } = await cache(fetchImpl);

    expect((await artwork.get(banner))?.contentType).toBe("image/jpeg");
    fetchImpl.mockRejectedValue(new Error("offline"));
    expect((await artwork.get(banner))?.body).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "User-Agent": "test" });
  });

  it("never fetches hosts outside the allowlist and refuses non-images", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(image("text/html"));
    const { cache: artwork } = await cache(fetchImpl);

    expect(await artwork.get("https://example.test/a.jpg")).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await artwork.get(banner)).toBeUndefined();
  });

  it("evicts the least recently used copies beyond its bound", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => image());
    const { cache: artwork, directory } = await cache(fetchImpl, { maxFiles: 2 });
    for (const id of [1, 2, 3]) await artwork.get(banner.replace("1.jpg", `${id}.jpg`));
    await artwork.evict();
    expect(await readdir(directory)).toHaveLength(2);
  });

  it("round-trips only allowlisted URLs through the artwork scheme", () => {
    const cached = cachedArtworkUrl(banner);
    expect(cached.startsWith("anistream-art://image/")).toBe(true);
    expect(artworkSourceFromCacheUrl(cached)).toBe(banner);
    expect(cachedArtworkUrl("https://example.test/a.jpg")).toBe("https://example.test/a.jpg");
    expect(
      artworkSourceFromCacheUrl("anistream-art://image/?src=https%3A%2F%2Fexample.test%2Fa.jpg"),
    ).toBeUndefined();
    expect(isCacheableArtworkUrl("http://s4.anilist.co/a.jpg")).toBe(false);
  });
});
