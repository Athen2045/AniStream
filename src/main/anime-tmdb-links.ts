import type Database from "better-sqlite3";
import type { MoreMediaType } from "../shared/contracts";

/**
 * Exact AniList anime ↔ TMDB links from Wikidata (CC0): properties P8729 (AniList anime ID),
 * P4983 (TMDB TV series ID) and P4947 (TMDB movie ID), directly or via the series item. Used only to keep the same work out of
 * the other section's recommendations; identity never comes from title text.
 */
export interface AnimeTmdbLink {
  anilistId: number;
  type: MoreMediaType;
  tmdbId: number;
}

export interface AnimeTmdbLinkIndex {
  /** TMDB titles linked to an AniList anime, as `MOVIE:id` / `TV:id` keys. */
  tmdbKeysFor(anilistId: number): string[];
  /** AniList anime linked to a TMDB title. */
  aniListIdsFor(type: MoreMediaType, tmdbId: number): number[];
}

const SPARQL_URL = "https://query.wikidata.org/sparql";
// Wikidata often keeps the TMDB TV ID on the series item and AniList IDs on its season items,
// so one structural hop (P179 "part of the series" / P361 "part of") is followed too.
const QUERY = `SELECT ?anilist ?tv ?movie WHERE {
  {
    ?item wdt:P8729 ?anilist .
    OPTIONAL { ?item wdt:P4983 ?tv }
    OPTIONAL { ?item wdt:P4947 ?movie }
  } UNION {
    ?item wdt:P8729 ?anilist ;
      wdt:P179|wdt:P361 ?series .
    OPTIONAL { ?series wdt:P4983 ?tv }
    OPTIONAL { ?series wdt:P4947 ?movie }
  }
  FILTER(BOUND(?tv) || BOUND(?movie))
}`;
// Wikimedia's User-Agent policy asks automated clients for contact information; this is the
// public project URL, identical for every install, never anything about the viewer.
const USER_AGENT = "AniStream (personal desktop app; https://github.com/Athen2045/AniStream)";
const REFRESH_AFTER_MS = 30 * 86_400_000;
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_LINKS = 50_000;
// Versioned with the query so a query change re-downloads on existing installs.
const META_KEY = "anime-tmdb-links.v2.fetched-at";

export function parseWikidataLinks(payload: unknown): AnimeTmdbLink[] {
  const bindings =
    isRecord(payload) && isRecord(payload.results) && Array.isArray(payload.results.bindings)
      ? payload.results.bindings
      : undefined;
  if (!bindings) throw new Error("Wikidata returned an invalid link response.");
  const links = new Map<string, AnimeTmdbLink>();
  for (const row of bindings.slice(0, MAX_LINKS)) {
    if (!isRecord(row)) continue;
    const anilistId = bindingId(row.anilist);
    if (anilistId === undefined) continue;
    for (const [field, type] of [
      ["tv", "TV"],
      ["movie", "MOVIE"],
    ] as const) {
      const tmdbId = bindingId(row[field]);
      if (tmdbId !== undefined)
        links.set(`${anilistId}:${type}:${tmdbId}`, { anilistId, type, tmdbId });
    }
  }
  return [...links.values()];
}

export class AnimeTmdbLinks {
  private refreshing?: Promise<void>;
  private retryAfter = 0;
  private cached?: AnimeTmdbLinkIndex;

  constructor(
    private readonly db: Database.Database,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS anime_tmdb_links_v1 (
      anilist_id INTEGER NOT NULL CHECK (anilist_id > 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('MOVIE', 'TV')),
      tmdb_id INTEGER NOT NULL CHECK (tmdb_id > 0),
      PRIMARY KEY (anilist_id, media_type, tmdb_id)
    );
    CREATE INDEX IF NOT EXISTS idx_anime_tmdb_links_tmdb
      ON anime_tmdb_links_v1 (media_type, tmdb_id);`);
  }

  /** The cached index; empty until the first successful download. */
  index(): AnimeTmdbLinkIndex {
    if (this.cached) return this.cached;
    const byAniList = new Map<number, string[]>();
    const byTmdb = new Map<string, number[]>();
    for (const row of this.db
      .prepare<[], { anilist_id: number; media_type: MoreMediaType; tmdb_id: number }>(
        "SELECT anilist_id, media_type, tmdb_id FROM anime_tmdb_links_v1",
      )
      .all()) {
      const key = `${row.media_type}:${row.tmdb_id}`;
      byAniList.set(row.anilist_id, [...(byAniList.get(row.anilist_id) ?? []), key]);
      byTmdb.set(key, [...(byTmdb.get(key) ?? []), row.anilist_id]);
    }
    this.cached = {
      tmdbKeysFor: (anilistId) => byAniList.get(anilistId) ?? [],
      aniListIdsFor: (type, tmdbId) => byTmdb.get(`${type}:${tmdbId}`) ?? [],
    };
    return this.cached;
  }

  /**
   * Starts a background refresh when stale. Before the first successful download there is nothing
   * to fall back on, so callers may wait up to `firstRunWaitMs` for it; later refreshes never wait.
   */
  async prepare(firstRunWaitMs: number): Promise<void> {
    const refresh = this.refreshIfStale();
    if (this.fetchedAt() > 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      refresh,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, firstRunWaitMs);
      }),
    ]);
    clearTimeout(timer);
  }

  /** Downloads fresh links in the background when stale; never throws and never runs twice. */
  refreshIfStale(): Promise<void> {
    const now = this.now();
    if (now - this.fetchedAt() < REFRESH_AFTER_MS || now < this.retryAfter)
      return Promise.resolve();
    this.refreshing ??= this.download()
      .catch(() => {
        // Keep the previous links; recommendations degrade to "no cross-section identity".
        // A provider Retry-After set during the download may be longer than the default.
        this.retryAfter = Math.max(this.retryAfter, this.now() + RETRY_AFTER_FAILURE_MS);
      })
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  private fetchedAt(): number {
    return Number(
      this.db
        .prepare<[string], { value: string }>("SELECT value FROM app_meta WHERE key=?")
        .get(META_KEY)?.value ?? 0,
    );
  }

  private async download(): Promise<void> {
    const url = new URL(SPARQL_URL);
    url.searchParams.set("query", QUERY);
    const response = await this.fetcher(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 429 || response.status === 403) {
      this.retryAfter = this.now() + Math.max(RETRY_AFTER_FAILURE_MS, retryAfterMs(response));
      throw new Error(`Wikidata refused requests (${response.status}).`);
    }
    if (!response.ok) throw new Error(`Wikidata request failed (${response.status}).`);
    const links = parseWikidataLinks(await response.json());
    if (!links.length) throw new Error("Wikidata returned no links.");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM anime_tmdb_links_v1").run();
      const insert = this.db.prepare("INSERT INTO anime_tmdb_links_v1 VALUES (?, ?, ?)");
      for (const link of links) insert.run(link.anilistId, link.type, link.tmdbId);
      this.db
        .prepare(
          "INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(META_KEY, String(this.now()));
    })();
    this.cached = undefined;
  }
}

function bindingId(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.value !== "string" || !/^\d{1,9}$/.test(value.value))
    return undefined;
  const id = Number(value.value);
  return id > 0 ? id : undefined;
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
