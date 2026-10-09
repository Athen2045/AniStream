import { describe, expect, it, vi } from "vitest";
import { AnimeTmdbLinks, parseWikidataLinks } from "../../src/main/anime-tmdb-links";
import Database from "better-sqlite3";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

const binding = (anilist: string, tv?: string, movie?: string) => ({
  anilist: { type: "literal", value: anilist },
  ...(tv ? { tv: { type: "literal", value: tv } } : {}),
  ...(movie ? { movie: { type: "literal", value: movie } } : {}),
});
const payload = (...rows: unknown[]) => ({ results: { bindings: rows } });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("Wikidata AniList ↔ TMDB links", () => {
  it("keeps only exact numeric IDs and deduplicates cartesian rows", () => {
    expect(
      parseWikidataLinks(
        payload(
          binding("21", "37854"),
          binding("21", "37854"),
          binding("199", undefined, "129"),
          binding("x1", "5"),
          binding("5", "tt123"),
          { anilist: { value: 7 } },
        ),
      ),
    ).toEqual([
      { anilistId: 21, type: "TV", tmdbId: 37854 },
      { anilistId: 199, type: "MOVIE", tmdbId: 129 },
    ]);
    expect(() => parseWikidataLinks({})).toThrow(/invalid/);
  });

  it("downloads once, indexes both directions, and refreshes only when stale", async () => {
    const db = memoryDb();
    let now = Date.UTC(2026, 9, 4);
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("query.wikidata.org/sparql");
      expect(new Headers(init?.headers).get("user-agent")).toMatch(/^AniStream \(/);
      return json(payload(binding("21", "37854"), binding("22", "37854")));
    });
    const links = new AnimeTmdbLinks(db, fetcher, () => now);
    try {
      expect(links.index().tmdbKeysFor(21)).toEqual([]);
      await links.prepare(1_000);
      expect(links.index().tmdbKeysFor(21)).toEqual(["TV:37854"]);
      expect(links.index().aniListIdsFor("TV", 37854).sort()).toEqual([21, 22]);
      await links.prepare(1_000);
      expect(fetcher).toHaveBeenCalledOnce();
      now += 31 * 86_400_000;
      await links.refreshIfStale();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it("keeps the previous links on failure and honors a long Retry-After", async () => {
    const db = memoryDb();
    let now = Date.UTC(2026, 9, 4);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(payload(binding("21", "37854"))))
      .mockResolvedValueOnce(json({}, 429, { "retry-after": String(2 * 86_400) }));
    const links = new AnimeTmdbLinks(db, fetcher as unknown as typeof fetch, () => now);
    try {
      await links.refreshIfStale();
      now += 31 * 86_400_000;
      await links.refreshIfStale(); // 429
      expect(links.index().tmdbKeysFor(21)).toEqual(["TV:37854"]);
      now += 86_400_000; // past the 6 h default, inside the 2-day Retry-After
      await links.refreshIfStale();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it("does not hold a For You load past the first-run wait", async () => {
    vi.useFakeTimers();
    const db = memoryDb();
    const links = new AnimeTmdbLinks(
      db,
      vi.fn(() => new Promise<Response>(() => undefined)),
      () => 0,
    );
    try {
      const waiting = links.prepare(5_000);
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(waiting).resolves.toBeUndefined();
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });
});
