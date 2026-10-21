import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AnimeDirectSource } from "../../src/main/anime-direct-source";
import { DIRECT_MATCH_TTL_MS, createDirectMatchStore } from "../../src/main/direct-match-store";
import type { AnimeDirectHlsProvider } from "../../src/main/provider-config";

const config: AnimeDirectHlsProvider = {
  id: "direct",
  kind: "direct-hls",
  searchUrl: "https://direct.example/anime?search={query}",
  titleUrl: "https://direct.example/anime/{slug}",
  episodeUrl: "https://direct.example/anime/{slug}/{episode}",
};

/** Pages embed JSON in Alpine x-data with " quote escapes, as the source does. */
const alpine = (value: unknown): string =>
  `<div x-data="{ items: JSON.parse('${JSON.stringify(value).replace(/"/g, "\\u0022")}'), more: 1 }"></div>`;

const target = {
  titles: ["Sousou no Frieren"],
  format: "TV",
  startDate: "2023-09-29",
  episodes: 28,
  airing: false,
};

/** A source whose search finds `slug` (or nothing), counting requests. */
function fakeSource(found: string | undefined) {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url.pathname + url.search);
    if (url.searchParams.has("search"))
      return new Response(
        alpine(
          found
            ? [
                {
                  slug: found,
                  main_title: "Frieren",
                  type: "TV Series",
                  start_year: 2023,
                  episode_count: 28,
                },
              ]
            : [],
        ),
      );
    return new Response(alpine([{ slug: "1", air_date: "2023-09-29" }]));
  }) as typeof fetch;
  return { fetcher, urls };
}

describe("direct match store", () => {
  it("keeps slugs, marks them stale after a month, and refuses malformed rows", () => {
    const store = createDirectMatchStore(new Database(":memory:"));
    expect(store.get(1, 0)).toBeUndefined();
    store.save(1, "mdkytdqp", 1_000);
    expect(store.get(1, 1_000 + DIRECT_MATCH_TTL_MS - 1)).toEqual({
      slug: "mdkytdqp",
      stale: false,
    });
    expect(store.get(1, 1_000 + DIRECT_MATCH_TTL_MS)).toEqual({ slug: "mdkytdqp", stale: true });
    store.save(2, "../etc", 1_000);
    store.save(0, "mdkytdqp", 1_000);
    expect(store.get(2, 1_000)).toBeUndefined();
    expect(store.get(0, 1_000)).toBeUndefined();
    store.forget(1);
    expect(store.get(1, 1_000)).toBeUndefined();
  });
});

describe("AnimeDirectSource with a match store", () => {
  it("saves a new match and serves it on a later launch without searching", async () => {
    const db = new Database(":memory:");
    const first = fakeSource("mdkytdqp");
    const source = new AnimeDirectSource(config, first.fetcher, () => 1_000);
    source.useMatchStore(createDirectMatchStore(db));
    expect(await source.match(154587, target)).toBe("mdkytdqp");

    const later = fakeSource(undefined);
    const relaunched = new AnimeDirectSource(config, later.fetcher, () => 2_000);
    relaunched.useMatchStore(createDirectMatchStore(db));
    expect(await relaunched.match(154587, target)).toBe("mdkytdqp");
    expect(later.urls).toEqual([]);
  });

  it("re-checks a stale match, keeping it when the re-check finds nothing", async () => {
    const db = new Database(":memory:");
    const store = createDirectMatchStore(db);
    store.save(154587, "mdkytdqp", 0);
    const empty = fakeSource(undefined);
    const source = new AnimeDirectSource(config, empty.fetcher, () => DIRECT_MATCH_TTL_MS + 1);
    source.useMatchStore(store);
    expect(await source.match(154587, target)).toBe("mdkytdqp");
    expect(empty.urls.length).toBeGreaterThan(0);
    // Still stale (not refreshed by a failed re-check), so it is tried again next time.
    expect(store.get(154587, DIRECT_MATCH_TTL_MS + 1)?.stale).toBe(true);
  });

  it("does not store misses", async () => {
    const db = new Database(":memory:");
    const store = createDirectMatchStore(db);
    const source = new AnimeDirectSource(config, fakeSource(undefined).fetcher, () => 1_000);
    source.useMatchStore(store);
    expect(await source.match(154587, target)).toBeUndefined();
    expect(store.get(154587, 1_000)).toBeUndefined();
  });
});
