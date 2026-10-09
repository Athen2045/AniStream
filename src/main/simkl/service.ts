import type {
  MoreMediaType,
  MoreTitleStatusAction,
  SimklAuthState,
  SimklProfile,
  SimklRow,
  SimklStats,
  SimklStatus,
  SimklTitleRatings,
} from "../../shared/contracts";
import type { MoreHistoryEntry } from "../more-library";
import type { SimklClient } from "./client";
import { collaborativeEdges, parseSimklTitle, type SimklCatalogStore } from "./collaborative";
import { parseSimklList, parseSimklLists, SIMKL_TRENDING, trendingRow } from "./discover";
import { simklHistory, simklPosterUrl, syncSimklLibrary, type SimklLibraryStore } from "./library";

/** Background checks never run more often than this; "Sync now" bypasses it. */
const STALE_AFTER_MS = 30 * 60_000;
/** Trending files regenerate daily; lists change rarely and cost the viewer's daily quota. */
const ROWS_TTL_MS = 6 * 60 * 60_000;
const MAX_LIST_ROWS = 4;
/** Simkl title pages fetched per background run (seeds plus their co-watched neighbours). */
const COLLABORATIVE_BUDGET = 24;
const CATALOG_TTL_MS = 30 * 86_400_000;
/**
 * Simkl computes stats live on every request and allows them only when the viewer opens a stats
 * screen, so they are read when the profile opens and reused for six hours.
 */
const STATS_TTL_MS = 6 * 60 * 60_000;
/** Title ratings are edge-cached catalog reads (no token); keep a day, at most 300 titles. */
const RATINGS_TTL_MS = 24 * 60 * 60_000;
const RATINGS_CACHE_SIZE = 300;

/** Owns when the Simkl library syncs and what the renderer is told about it. */
export class SimklService {
  private syncing?: Promise<void>;
  private error?: string;
  private rowsCache?: { key: string; rows: SimklRow[]; expiresAt: number };
  private rowsPending?: Promise<SimklRow[]>;
  private warming?: Promise<void>;
  private statsCache?: { accountId: number; stats: SimklStats; expiresAt: number };
  private readonly ratingsCache = new Map<
    string,
    { value: SimklTitleRatings | undefined; expiresAt: number }
  >();

  public constructor(
    private readonly client: Pick<
      SimklClient,
      | "connected"
      | "getState"
      | "get"
      | "post"
      | "getPublic"
      | "accountId"
      | "titleLink"
      | "refreshProfile"
      | "getCatalog"
      | "simklIdForTmdb"
    >,
    private readonly store: SimklLibraryStore,
    private readonly onChange: (status: SimklStatus) => void,
    private readonly now: () => number = Date.now,
    private readonly catalog?: SimklCatalogStore,
  ) {}

  public status(auth: SimklAuthState = this.client.getState()): SimklStatus {
    if (auth.status !== "connected") return { auth };
    const rows = this.store.rows();
    const syncedAt = this.store.syncedAt();
    return {
      auth,
      library: {
        movies: rows.filter((row) => row.type === "MOVIE").length,
        shows: rows.filter((row) => row.type === "TV").length,
        unmatched: rows.filter((row) => row.tmdbId === undefined).length,
        syncedAt: syncedAt ? new Date(syncedAt).toISOString() : undefined,
        syncing: Boolean(this.syncing),
        error: this.error,
      },
    };
  }

  /** Called with every auth change; a fresh connection imports right away. */
  public authChanged(auth: SimklAuthState): void {
    if (auth.status !== "connected") {
      if (auth.status === "disconnected" || auth.status === "error") this.store.clear();
      this.error = undefined;
    }
    this.onChange(this.status(auth));
    if (auth.status === "connected" && !this.store.syncedAt()) void this.sync();
  }

  /**
   * Simkl's collaborative neighbours for one of the viewer's imported titles, from cache only
   * (no requests); undefined until `warmCollaborative` has fetched its title page.
   */
  public collaborative(ref: {
    type: MoreMediaType;
    tmdbId: number;
  }): ReturnType<typeof collaborativeEdges> {
    if (!this.catalog || !this.client.connected) return undefined;
    const row = this.store
      .rows()
      .find((candidate) => candidate.type === ref.type && candidate.tmdbId === ref.tmdbId);
    return row
      ? collaborativeEdges(this.catalog, { type: row.type, simklId: row.simklId })
      : undefined;
  }

  /**
   * Fetches Simkl title pages for the given titles and their co-watched neighbours, a bounded
   * number per run, one at a time through the client's gate. Title pages are quota-free CDN
   * responses; each is cached for 30 days. Stops at the first failure; never runs twice at once.
   */
  public warmCollaborative(
    refs: ReadonlyArray<{ type: MoreMediaType; tmdbId: number }>,
    budget = COLLABORATIVE_BUDGET,
  ): Promise<void> {
    const catalog = this.catalog;
    if (!catalog || !this.client.connected) return Promise.resolve();
    this.warming ??= (async () => {
      const now = this.now();
      const fresh = (type: MoreMediaType, simklId: number): boolean => {
        const cached = catalog.get(type, simklId);
        return Boolean(cached && cached.updatedAt > now - CATALOG_TTL_MS);
      };
      let left = budget;
      const fetchTitle = async (type: MoreMediaType, simklId: number) => {
        left -= 1;
        const payload = await this.client.getCatalog(
          `/${type === "MOVIE" ? "movies" : "tv"}/${simklId}`,
        );
        const title = parseSimklTitle(payload, type, simklId, this.now());
        catalog.save(title, this.now());
        return title;
      };
      const rows = this.store.rows();
      try {
        for (const ref of refs) {
          if (left <= 0) return;
          const row = rows.find((item) => item.type === ref.type && item.tmdbId === ref.tmdbId);
          if (!row) continue;
          const seed = fresh(row.type, row.simklId)
            ? catalog.get(row.type, row.simklId)!.title
            : await fetchTitle(row.type, row.simklId);
          for (const neighbour of seed.recommendations) {
            if (left <= 0) return;
            if (!fresh(neighbour.type, neighbour.simklId))
              await fetchTitle(neighbour.type, neighbour.simklId);
          }
        }
      } catch {
        // Simkl's gate owns any cool-down; the next load continues from the cache.
      }
    })().finally(() => {
      this.warming = undefined;
    });
    return this.warming;
  }

  /** Imported titles as More evidence; empty while disconnected. */
  public history(): MoreHistoryEntry[] {
    return this.client.connected ? simklHistory(this.store.rows()) : [];
  }

  public syncIfStale(): Promise<void> {
    const syncedAt = this.store.syncedAt() ?? 0;
    if (!this.client.connected || this.now() - syncedAt < STALE_AFTER_MS) return Promise.resolve();
    return this.sync();
  }

  /** Never throws; a failure is reported in the status and keeps the last imported library. */
  public sync(): Promise<void> {
    if (!this.client.connected) return Promise.resolve();
    this.syncing ??= (async () => {
      this.onChange(this.status());
      try {
        await syncSimklLibrary(this.client, this.store, this.now());
        this.error = undefined;
        await this.client.refreshProfile();
      } catch (reason) {
        this.error = syncMessage(reason);
      }
    })().finally(() => {
      this.syncing = undefined;
      this.onChange(this.status());
    });
    return this.syncing;
  }

  /**
   * Mirrors a "+" choice on the viewer's Simkl account when connected with write access:
   * Plan to Watch via `/sync/add-to-list`, Completed via `/sync/history` (the documented
   * "mark watched" path), and removal only for titles Simkl holds as Plan to Watch, so un-saving
   * here can never erase watch history there. Returns false when nothing was sent.
   */
  public async setTitleStatus(
    ref: { type: MoreMediaType; tmdbId: number },
    action: MoreTitleStatusAction,
  ): Promise<boolean> {
    const auth = this.client.getState();
    if (auth.status !== "connected" || !auth.canWrite) return false;
    const ids = { tmdb: String(ref.tmdbId) };
    const bucket = ref.type === "MOVIE" ? "movies" : "shows";
    let path: string;
    let entry: Record<string, unknown>;
    if (action === "planning") {
      path = "/sync/add-to-list";
      entry = { to: "plantowatch", ids };
    } else if (action === "completed") {
      path = "/sync/history";
      entry = ref.type === "MOVIE" ? { ids } : { ids, status: "completed" };
    } else {
      const row = this.store
        .rows()
        .find((candidate) => candidate.type === ref.type && candidate.tmdbId === ref.tmdbId);
      if (row?.status !== "planning") return false;
      path = "/sync/history/remove";
      entry = { ids };
    }
    const result = await this.client.post(path, { [bucket]: [entry] });
    const missing =
      isRecord(result) && isRecord(result.not_found) ? result.not_found[bucket] : undefined;
    if (Array.isArray(missing) && missing.length)
      throw new Error("Simkl does not know this title yet, so it was saved only here.");
    void this.sync();
    return true;
  }

  /**
   * Sends the viewer's 1–10 rating (or its removal) to Simkl when it can write. Re-rating
   * overwrites; rating an unlisted title lets Simkl file it, which the next sync picks up.
   */
  public async setRating(
    ref: { type: MoreMediaType; tmdbId: number },
    rating: number | undefined,
  ): Promise<boolean> {
    const auth = this.client.getState();
    if (auth.status !== "connected" || !auth.canWrite) return false;
    const bucket = ref.type === "MOVIE" ? "movies" : "shows";
    const ids = { tmdb: String(ref.tmdbId) };
    const result =
      rating === undefined
        ? await this.client.post("/sync/ratings/remove", { [bucket]: [{ ids }] })
        : await this.client.post("/sync/ratings", { [bucket]: [{ ids, rating }] });
    const missing =
      isRecord(result) && isRecord(result.not_found) ? result.not_found[bucket] : undefined;
    if (Array.isArray(missing) && missing.length)
      throw new Error("Simkl does not know this title yet, so it was saved only here.");
    void this.sync();
    return true;
  }

  /** Simkl's page for a title while connected (Simkl asks apps to link back to its data). */
  public titleLink(ref: { type: MoreMediaType; tmdbId: number }): string | undefined {
    return this.client.connected ? this.client.titleLink(ref.type, ref.tmdbId) : undefined;
  }

  /** The rating Simkl holds for a title, from the imported library. */
  public ratingFor(ref: { type: MoreMediaType; tmdbId: number }): number | undefined {
    if (!this.client.connected) return undefined;
    return this.store.rows().find((row) => row.type === ref.type && row.tmdbId === ref.tmdbId)
      ?.rating;
  }

  /**
   * The connected viewer's Simkl identity and imported library, at once from this device. Stats are
   * included only when already cached; `stats()` reads them (Simkl computes them live).
   */
  public async profile(): Promise<SimklProfile | undefined> {
    const auth = this.client.getState();
    if (auth.status !== "connected") return undefined;
    const items = this.store.rows().map((row) => ({
      type: row.type,
      simklId: row.simklId,
      tmdbId: row.tmdbId,
      title: row.title ?? "Untitled",
      posterUrl: simklPosterUrl(row.poster),
      year: row.year,
      status: row.status,
      rating: row.rating,
      watchedEpisodes: row.watchedEpisodes,
      totalEpisodes: row.totalEpisodes,
      updatedAt: row.updatedAt,
    }));
    return {
      name: auth.userName,
      avatarUrl: auth.avatarUrl,
      joinedAt: auth.joinedAt,
      stats:
        this.statsCache?.accountId === this.client.accountId ? this.statsCache?.stats : undefined,
      items,
    };
  }

  /** Watch-time stats for the open profile, cached six hours; undefined when unavailable. */
  public async stats(): Promise<SimklStats | undefined> {
    if (!this.client.connected) return undefined;
    return this.loadStats().catch(() => this.statsCache?.stats);
  }

  private async loadStats(): Promise<SimklStats | undefined> {
    const accountId = this.client.accountId;
    if (accountId === undefined) return undefined;
    const cached = this.statsCache;
    if (cached?.accountId === accountId && cached.expiresAt > this.now()) return cached.stats;
    const stats = parseStats(await this.client.get(`/users/${accountId}/stats`));
    if (stats) this.statsCache = { accountId, stats, expiresAt: this.now() + STATS_TTL_MS };
    return stats;
  }

  /**
   * Simkl's community score and the IMDb score Simkl carries for a More title, only while Simkl
   * is connected (the page links back to Simkl). Two untokened, edge-cached reads: TMDB → Simkl
   * ID through `/redirect`, then the title. Failures and unknown titles return undefined.
   */
  public async titleRatings(ref: {
    type: MoreMediaType;
    tmdbId: number;
  }): Promise<SimklTitleRatings | undefined> {
    if (!this.client.connected) return undefined;
    const key = `${ref.type}:${ref.tmdbId}`;
    const cached = this.ratingsCache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    let value: SimklTitleRatings | undefined;
    try {
      const id = await this.client.simklIdForTmdb(ref.type, ref.tmdbId);
      if (id !== undefined)
        value = parseTitleRatings(
          await this.client.getCatalog(`/${ref.type === "MOVIE" ? "movies" : "tv"}/${id}`),
          this.client.titleLink(ref.type, ref.tmdbId),
        );
    } catch {
      return cached?.value;
    }
    this.ratingsCache.delete(key);
    this.ratingsCache.set(key, { value, expiresAt: this.now() + RATINGS_TTL_MS });
    while (this.ratingsCache.size > RATINGS_CACHE_SIZE)
      this.ratingsCache.delete(this.ratingsCache.keys().next().value!);
    return value;
  }

  /**
   * Simkl rows for More: the two weekly Trending files (no account needed), then for PRO/VIP
   * accounts the Custom Lists the viewer owns or follows. Cached for six hours; a failing source
   * is skipped rather than failing the others.
   */
  public rows(): Promise<SimklRow[]> {
    const auth = this.client.getState();
    const premium = auth.status === "connected" && auth.premium ? this.client.accountId : undefined;
    const key = `rows:${premium ?? "public"}`;
    if (this.rowsCache?.key === key && this.rowsCache.expiresAt > this.now())
      return Promise.resolve(this.rowsCache.rows);
    this.rowsPending ??= this.loadRows(premium)
      .then((rows) => {
        this.rowsCache = { key, rows, expiresAt: this.now() + ROWS_TTL_MS };
        return rows;
      })
      .finally(() => {
        this.rowsPending = undefined;
      });
    return this.rowsPending;
  }

  private async loadRows(accountId: number | undefined): Promise<SimklRow[]> {
    const rows: SimklRow[] = [];
    for (const source of SIMKL_TRENDING) {
      const row = await this.client
        .getPublic(source.url)
        .then((payload) => trendingRow(source, payload))
        .catch(() => undefined);
      if (row) rows.push(row);
    }
    if (accountId === undefined) return rows;
    const lists = await this.client
      .get(`/lists/user/${accountId}`, { followed: "true", limit: "50" })
      .then(parseSimklLists)
      .catch(() => []);
    for (const list of lists.sort((a, b) => b.likes - a.likes).slice(0, MAX_LIST_ROWS)) {
      const row = await this.client
        .get(`/lists/${list.id}`, { limit: "20" })
        .then((payload) => parseSimklList(payload, list))
        .catch(() => undefined);
      if (row) rows.push(row);
    }
    return rows;
  }
}

export function parseStats(payload: unknown): SimklStats | undefined {
  if (!isRecord(payload)) return undefined;
  const minutes = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const tv = isRecord(payload.tv) ? payload.tv : {};
  const movies = isRecord(payload.movies) ? payload.movies : {};
  const episodes = ["watching", "hold", "dropped", "completed"].reduce((sum, key) => {
    const bucket = tv[key];
    return sum + (isRecord(bucket) ? minutes(bucket.watched_episodes_count) : 0);
  }, 0);
  const movieMinutes = minutes(movies.total_mins);
  const tvMinutes = minutes(tv.total_mins);
  return { totalMinutes: movieMinutes + tvMinutes, movieMinutes, tvMinutes, episodes };
}

export function parseTitleRatings(
  payload: unknown,
  simklUrl: string,
): SimklTitleRatings | undefined {
  if (!isRecord(payload) || !isRecord(payload.ratings)) return undefined;
  const score = (value: unknown): { rating: number; votes: number } | undefined => {
    if (!isRecord(value)) return undefined;
    const { rating, votes } = value;
    if (typeof rating !== "number" || !(rating > 0 && rating <= 10)) return undefined;
    return {
      rating: Math.round(rating * 10) / 10,
      votes: typeof votes === "number" && votes > 0 ? Math.round(votes) : 0,
    };
  };
  const simkl = score(payload.ratings.simkl);
  const imdb = score(payload.ratings.imdb);
  if (!simkl && !imdb) return undefined;
  const imdbId =
    isRecord(payload.ids) && typeof payload.ids.imdb === "string" ? payload.ids.imdb : "";
  return {
    simkl,
    imdb,
    simklUrl,
    imdbUrl:
      imdb && /^tt\d{5,10}$/.test(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : undefined,
  };
}

function syncMessage(reason: unknown): string {
  const raw = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
  if (/slow down|\b429\b/i.test(raw))
    return "Simkl asked AniStream to wait. Sync will try again later.";
  if (/not connected|rejected|expired|disconnected/i.test(raw))
    return "Simkl disconnected AniStream. Connect it again.";
  if (/timeout|aborterror/i.test(raw)) return "Simkl took too long to answer. Try Sync now later.";
  if (/failed to fetch|network|enotfound|econn|dns/i.test(raw))
    return "Simkl could not be reached. Check your connection.";
  return "Simkl sync failed. Your last imported library is kept.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
