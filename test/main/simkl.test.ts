import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { mergeMoreHistory, type MoreHistoryEntry } from "../../src/main/more-library";
import { moreAffinity } from "../../src/main/recommendations/more-discovery-service";
import {
  SIMKL_CLIENT_ID,
  SIMKL_REDIRECT_URI,
  SimklClient,
  type SimklSession,
  type SimklSessionStorage,
} from "../../src/main/simkl/client";
import {
  createSimklLibraryStore,
  parseSimklItems,
  simklHistory,
  syncSimklLibrary,
  type SimklReader,
} from "../../src/main/simkl/library";
import { SimklService } from "../../src/main/simkl/service";
import type { SimklAuthState } from "../../src/shared/contracts";

const now = Date.UTC(2026, 9, 6);

function memoryStore() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return { db, store: createSimklLibraryStore(db) };
}

const movie = (
  simkl: number,
  patch: Record<string, unknown> = {},
  tmdb: string | null = String(simkl + 1000),
) => ({
  added_to_watchlist_at: "2026-05-01T00:00:00Z",
  last_watched_at: "2026-05-02T00:00:00Z",
  user_rated_at: null,
  user_rating: null,
  status: "completed",
  watched_episodes_count: 0,
  movie: {
    title: `Movie ${simkl}`,
    year: 2020,
    ids: { simkl, slug: `m-${simkl}`, ...(tmdb ? { tmdb } : {}) },
  },
  ...patch,
});
const show = (simkl: number, patch: Record<string, unknown> = {}) => ({
  added_to_watchlist_at: "2026-05-01T00:00:00Z",
  last_watched_at: "2026-05-03T00:00:00Z",
  user_rating: null,
  status: "watching",
  watched_episodes_count: 3,
  show: { title: `Show ${simkl}`, ids: { simkl, tmdb: String(simkl + 2000) } },
  ...patch,
});
const activities = (
  all: string,
  movies: Record<string, string> = {},
  shows: Record<string, string> = {},
) => ({
  all,
  movies: { all, rated_at: "r1", removed_from_list: "x1", ...movies },
  tv_shows: { all, rated_at: "r1", removed_from_list: "x1", ...shows },
});

describe("Simkl library parsing", () => {
  it("normalizes statuses, string TMDB IDs, ratings and drops malformed rows", () => {
    const rows = parseSimklItems(
      {
        movies: [
          movie(1, { user_rating: 9 }),
          movie(2, { status: "plantowatch", last_watched_at: null }),
          movie(3, {}, null),
          movie(4, { status: "bogus" }),
          { status: "completed", movie: { ids: { simkl: "5" } } },
          movie(6, { user_rating: 11 }),
        ],
      },
      "MOVIE",
    );
    expect(
      rows.map((row) => [row.simklId, row.tmdbId, row.status, row.rating, row.watchedEpisodes]),
    ).toEqual([
      [1, 1001, "completed", 9, 1],
      [2, 1002, "planning", undefined, 0],
      [3, undefined, "completed", undefined, 1],
      [6, 1006, "completed", undefined, 1],
    ]);
    expect(rows[0].updatedAt).toBe("2026-05-02T00:00:00Z");
    expect(parseSimklItems({}, "TV")).toEqual([]);
    expect(parseSimklItems(null, "TV")).toEqual([]);
    expect(() => parseSimklItems({ shows: "no" }, "TV")).toThrow(/invalid/);
  });

  it("turns rows into More history and skips titles without a TMDB ID", () => {
    const history = simklHistory(
      parseSimklItems({ movies: [movie(1), movie(3, {}, null)] }, "MOVIE"),
    );
    expect(history).toEqual([
      expect.objectContaining({
        type: "MOVIE",
        tmdbId: 1001,
        trackerStatus: "completed",
        finishedEpisodes: 1,
      }),
    ]);
  });
});

describe("Simkl two-phase sync (empty library)", () => {
  it("makes no library requests while Simkl reports no activity", async () => {
    const { db, store } = memoryStore();
    try {
      const empty = {
        all: null,
        movies: { all: null, rated_at: null, removed_from_list: null },
        tv_shows: { all: null, rated_at: null, removed_from_list: null },
      };
      const get = vi.fn(async () => empty);
      await syncSimklLibrary({ get }, store, now);
      await syncSimklLibrary({ get }, store, now + 1);
      expect(get.mock.calls.map(([path]) => path)).toEqual([
        "/sync/activities",
        "/sync/activities",
      ]);
      expect(store.syncedAt()).toBe(now + 1);
    } finally {
      db.close();
    }
  });
});

describe("Simkl two-phase sync", () => {
  function reader(responses: Record<string, unknown[]>): SimklReader & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      get: vi.fn(async (path: string, params: Record<string, string> = {}) => {
        const key = `${path}${params.date_from ? `?date_from=${params.date_from}` : ""}`;
        calls.push(key);
        const queue = responses[key];
        if (!queue?.length) throw new Error(`unexpected ${key}`);
        return queue.shift();
      }),
    };
  }

  it("pulls everything once, skips unchanged activity, then fetches only a delta", async () => {
    const { db, store } = memoryStore();
    try {
      const first = reader({
        "/sync/activities": [activities("t1")],
        "/sync/all-items/movies": [{ movies: [movie(1), movie(2)] }],
        "/sync/all-items/shows": [{ shows: [show(10)] }],
      });
      await syncSimklLibrary(first, store, now);
      expect(first.calls).toEqual([
        "/sync/activities",
        "/sync/all-items/movies",
        "/sync/all-items/shows",
      ]);
      expect(store.rows()).toHaveLength(3);
      expect(store.syncedAt()).toBe(now);

      const idle = reader({ "/sync/activities": [activities("t1")] });
      expect(await syncSimklLibrary(idle, store, now + 1)).toEqual({ changed: false });
      expect(idle.calls).toEqual(["/sync/activities"]);

      const delta = reader({
        "/sync/activities": [
          { ...activities("t2"), tv_shows: { all: "t1", rated_at: "r1", removed_from_list: "x1" } },
        ],
        "/sync/all-items/movies?date_from=t1": [
          { movies: [movie(2, { user_rating: 4 }), movie(7)] },
        ],
      });
      await syncSimklLibrary(delta, store, now + 2);
      expect(delta.calls).toEqual(["/sync/activities", "/sync/all-items/movies?date_from=t1"]);
      expect(store.rows().find((row) => row.simklId === 2)?.rating).toBe(4);
      expect(store.rows()).toHaveLength(4);
    } finally {
      db.close();
    }
  });

  it("re-pulls a type after a removal and keeps the old snapshot when a fetch fails", async () => {
    const { db, store } = memoryStore();
    try {
      await syncSimklLibrary(
        reader({
          "/sync/activities": [activities("t1")],
          "/sync/all-items/movies": [{ movies: [movie(1), movie(2)] }],
          "/sync/all-items/shows": [{}],
        }),
        store,
        now,
      );
      const failing = reader({
        "/sync/activities": [activities("t2", { removed_from_list: "x2" })],
      });
      await expect(syncSimklLibrary(failing, store, now + 1)).rejects.toThrow(/unexpected/);
      expect(store.snapshot()?.all).toBe("t1");

      await syncSimklLibrary(
        reader({
          "/sync/activities": [activities("t2", { removed_from_list: "x2" })],
          "/sync/all-items/movies": [{ movies: [movie(2)] }],
          "/sync/all-items/shows?date_from=t1": [{}],
        }),
        store,
        now + 2,
      );
      expect(store.rows().map((row) => row.simklId)).toEqual([2]);
    } finally {
      db.close();
    }
  });
});

describe("Simkl evidence", () => {
  const entry = (patch: Partial<MoreHistoryEntry>): MoreHistoryEntry => ({
    type: "MOVIE",
    tmdbId: 1,
    watchlisted: false,
    maxRatio: 0,
    finishedEpisodes: 0,
    updatedAt: new Date(now).toISOString(),
    ...patch,
  });

  it("reads ratings against the viewer's mean and status like AniList entries", () => {
    expect(moreAffinity(entry({ rating: 10 }), 8)).toBe(1);
    expect(moreAffinity(entry({ rating: 7 }), 8)).toBe(0);
    expect(moreAffinity(entry({ rating: 4 }), 8)).toBe(-1);
    expect(moreAffinity(entry({ rating: 9, trackerStatus: "dropped" }), 8)).toBe(-0.3);
    expect(moreAffinity(entry({ trackerStatus: "dropped" }))).toBe(-0.6);
    expect(moreAffinity(entry({ trackerStatus: "paused", finishedEpisodes: 5, type: "TV" }))).toBe(
      0,
    );
    expect(moreAffinity(entry({ trackerStatus: "completed", type: "TV" }))).toBe(0.6);
    expect(moreAffinity(entry({ trackerStatus: "planning", watchlisted: true }))).toBe(0.25);
    expect(
      moreAffinity(entry({ trackerStatus: "watching", type: "TV", finishedEpisodes: 1 })),
    ).toBe(0.35);
  });

  it("merges local playback and tracker rows per title", () => {
    const merged = mergeMoreHistory(
      [entry({ maxRatio: 0.5, updatedAt: "2026-10-05T00:00:00Z" })],
      [
        entry({
          trackerStatus: "completed",
          rating: 8,
          finishedEpisodes: 1,
          updatedAt: "2026-01-01T00:00:00Z",
        }),
        entry({ tmdbId: 2 }),
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      maxRatio: 0.5,
      finishedEpisodes: 1,
      trackerStatus: "completed",
      rating: 8,
      updatedAt: "2026-10-05T00:00:00Z",
    });
  });
});

describe("Simkl sign-in and requests", () => {
  function memorySession(initial?: SimklSession): SimklSessionStorage & { value?: SimklSession } {
    const storage: SimklSessionStorage & { value?: SimklSession } = {
      value: initial,
      load: async () => storage.value,
      save: async (session) => {
        storage.value = { ...session };
      },
      remove: async () => {
        storage.value = undefined;
      },
    };
    return storage;
  }
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  function client(
    fetcher: (url: URL, init: RequestInit) => Promise<Response>,
    session?: SimklSession,
  ) {
    const storage = memorySession(session);
    const states: SimklAuthState[] = [];
    let opened = "";
    const instance = new SimklClient({
      appVersion: "0.1.7",
      storage,
      openExternal: async (url) => {
        opened = url;
      },
      emitState: (state) => states.push(state),
      fetcher: ((input: string | URL | Request, init?: RequestInit) =>
        fetcher(new URL(String(input)), init ?? {})) as typeof fetch,
      now: () => now,
    });
    return { instance, storage, states, opened: () => opened };
  }

  it("signs in with PKCE, validates iss and state, and stores the grant", async () => {
    const requests: { url: URL; init: RequestInit }[] = [];
    const { instance, storage, states, opened } = client(async (url, init) => {
      requests.push({ url, init });
      if (url.pathname === "/oauth2/token")
        return json({
          access_token: "simkl_at_a",
          refresh_token: "simkl_rt_a",
          expires_in: 604800,
          scope: "media:read media:write",
        });
      return json({ user: { name: "athen" }, account: { id: 1, type: "vip" } });
    });
    await instance.startLogin();
    const authorize = new URL(opened());
    expect(authorize.origin + authorize.pathname).toBe("https://simkl.com/oauth2/authorize");
    expect(authorize.searchParams.get("client_id")).toBe(SIMKL_CLIENT_ID);
    expect(authorize.searchParams.get("redirect_uri")).toBe(SIMKL_REDIRECT_URI);
    expect(authorize.searchParams.get("scope")).toBe("media:read media:write");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state")!;

    // A response from another issuer is rejected before any code exchange.
    await instance.handleCallback(
      `${SIMKL_REDIRECT_URI}?code=c&state=${state}&iss=https%3A%2F%2Fevil.example`,
    );
    expect(requests).toHaveLength(0);
    expect(states.at(-1)).toEqual({
      status: "error",
      message: "The sign-in response did not come from Simkl.",
    });

    await instance.startLogin();
    const second = new URL(opened());
    await instance.handleCallback(
      `${SIMKL_REDIRECT_URI}?code=c2&state=${second.searchParams.get("state")}&iss=https%3A%2F%2Fsimkl.com`,
    );
    const body = new URLSearchParams(String(requests[0].init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c2");
    const challenge = createHash("sha256").update(body.get("code_verifier")!).digest("base64url");
    expect(challenge).toBe(second.searchParams.get("code_challenge"));
    expect(requests[1].url.pathname).toBe("/users/settings");
    expect(requests[1].url.searchParams.get("app-name")).toBe("anistream");
    expect(new Headers(requests[1].init.headers).get("authorization")).toBe("Bearer simkl_at_a");
    expect(new Headers(requests[1].init.headers).get("user-agent")).toBe("AniStream/0.1.7");
    expect(storage.value).toMatchObject({
      refreshToken: "simkl_rt_a",
      userName: "athen",
      accountId: 1,
    });
    expect(states.at(-1)).toEqual({
      status: "connected",
      userName: "athen",
      canWrite: true,
      premium: true,
    });
  });

  it("refreshes once on a 401 and stops on 429", async () => {
    const seen: string[] = [];
    const { instance, storage } = client(
      async (url, init) => {
        seen.push(`${init.method ?? "GET"} ${url.pathname}`);
        if (url.pathname === "/oauth2/token")
          return json({
            access_token: "simkl_at_b",
            refresh_token: "simkl_rt_a",
            expires_in: 604800,
          });
        const auth = new Headers(init.headers).get("authorization");
        if (url.pathname === "/sync/activities")
          return auth === "Bearer simkl_at_b" ? json({ all: "t" }) : json({}, 401);
        return json({}, 429, { "retry-after": "60" });
      },
      { accessToken: "simkl_at_a", refreshToken: "simkl_rt_a", expiresAt: now + 5 * 86_400_000 },
    );
    await instance.restore();
    await expect(instance.get("/sync/activities")).resolves.toEqual({ all: "t" });
    expect(seen).toEqual(["GET /sync/activities", "POST /oauth2/token", "GET /sync/activities"]);
    expect(storage.value?.accessToken).toBe("simkl_at_b");
    await expect(instance.get("/sync/all-items/movies")).rejects.toThrow(/slow down/);
  });

  it("disconnect forgets the grant locally and revokes it", async () => {
    const seen: string[] = [];
    const { instance, storage, states } = client(
      async (url) => {
        seen.push(url.pathname);
        return json({});
      },
      { accessToken: "simkl_at_a", refreshToken: "simkl_rt_a", expiresAt: now + 5 * 86_400_000 },
    );
    await instance.restore();
    await instance.logout();
    expect(storage.value).toBeUndefined();
    expect(seen).toEqual(["/oauth2/revoke"]);
    expect(states.at(-1)).toEqual({ status: "disconnected" });
  });
});

describe("Simkl service", () => {
  it("imports on first connect, reports counts, and clears on disconnect", async () => {
    const { db, store } = memoryStore();
    try {
      let connected = true;
      const statuses: unknown[] = [];
      const fake = {
        get connected() {
          return connected;
        },
        getState: (): SimklAuthState =>
          connected ? { status: "connected", userName: "athen" } : { status: "disconnected" },
        get: vi.fn(async (path: string) =>
          path === "/sync/activities"
            ? activities("t1")
            : path.endsWith("movies")
              ? { movies: [movie(1), movie(2, {}, null)] }
              : { shows: [show(10)] },
        ),
        post: vi.fn(async () => ({})),
        getPublic: vi.fn(async () => []),
        accountId: undefined,
      };
      const service = new SimklService(
        fake,
        store,
        (status) => statuses.push(status),
        () => now,
      );
      service.authChanged({ status: "connected", userName: "athen" });
      await service.sync();
      expect(service.status().library).toMatchObject({
        movies: 2,
        shows: 1,
        unmatched: 1,
        syncing: false,
      });
      expect(
        service
          .history()
          .map((row) => row.tmdbId)
          .sort(),
      ).toEqual([1001, 2010]);
      await service.syncIfStale();
      expect(fake.get).toHaveBeenCalledTimes(3);
      connected = false;
      service.authChanged({ status: "disconnected" });
      expect(store.rows()).toEqual([]);
      expect(service.history()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("Simkl writes and rows", () => {
  function fakeClient(state: SimklAuthState, responses: Record<string, unknown> = {}) {
    return {
      connected: state.status === "connected",
      getState: () => state,
      accountId: 77,
      get: vi.fn(async (path: string) => {
        if (path === "/sync/activities") return activities("t1");
        if (path in responses) return responses[path];
        return {};
      }),
      post: vi.fn(async (_path: string, _body: unknown) => ({
        not_found: { movies: [], shows: [] },
      })),
      getPublic: vi.fn(async (url: string) =>
        url.includes("/movies/")
          ? [
              {
                title: "Oak Street",
                poster: "20/2036989114a175eae4",
                ids: { simkl_id: 1, tmdb: "1101383" },
                release_date: "08/12/2026",
                ratings: { simkl: { rating: 6.16 } },
                genres: ["Action", "Action"],
              },
              { title: "No TMDB", ids: { simkl_id: 2 } },
            ]
          : [],
      ),
    };
  }

  it("maps + choices to Simkl's documented write endpoints and never erases history", async () => {
    const { db, store } = memoryStore();
    try {
      store.replace("MOVIE", [
        {
          type: "MOVIE",
          simklId: 9,
          tmdbId: 500,
          status: "completed",
          watchedEpisodes: 1,
          updatedAt: "x",
        },
      ]);
      const client = fakeClient({ status: "connected", canWrite: true });
      const service = new SimklService(
        client,
        store,
        () => undefined,
        () => now,
      );
      expect(await service.setTitleStatus({ type: "MOVIE", tmdbId: 27205 }, "planning")).toBe(true);
      expect(await service.setTitleStatus({ type: "TV", tmdbId: 1399 }, "completed")).toBe(true);
      expect(await service.setTitleStatus({ type: "MOVIE", tmdbId: 500 }, "unplanned")).toBe(false);
      expect(client.post.mock.calls).toEqual([
        ["/sync/add-to-list", { movies: [{ to: "plantowatch", ids: { tmdb: "27205" } }] }],
        ["/sync/history", { shows: [{ ids: { tmdb: "1399" }, status: "completed" }] }],
      ]);

      const readOnly = fakeClient({ status: "connected", canWrite: false });
      const skipped = new SimklService(
        readOnly,
        store,
        () => undefined,
        () => now,
      );
      expect(await skipped.setTitleStatus({ type: "MOVIE", tmdbId: 1 }, "completed")).toBe(false);
      expect(readOnly.post).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("builds Trending rows for everyone and list rows only for PRO/VIP accounts", async () => {
    const { db, store } = memoryStore();
    try {
      const free = fakeClient({ status: "connected", canWrite: true, premium: false });
      const rows = await new SimklService(
        free,
        store,
        () => undefined,
        () => now,
      ).rows();
      expect(rows.map((row) => row.title)).toEqual(["Trending Movies on Simkl This Week"]);
      expect(rows[0].items).toEqual([
        expect.objectContaining({
          id: 1101383,
          posterUrl: "https://simkl.in/posters/20/2036989114a175eae4_m.webp",
          year: 2026,
          score: 6.2,
          genres: ["Action"],
        }),
      ]);
      expect(free.get).not.toHaveBeenCalled();

      const pro = fakeClient(
        { status: "connected", premium: true },
        {
          "/lists/user/77": {
            lists: [
              {
                id: 5,
                name: "MonsterVerse (Movies)",
                media_type: "movies",
                counts: { items: 5, likes: 34 },
              },
              { id: 6, name: "Anime picks", media_type: "anime", counts: { items: 9, likes: 99 } },
              { id: 7, name: "Locked", media_type: "tv", counts: { items: 3, likes: 1 } },
            ],
          },
          "/lists/5": { items: [{ title: "Godzilla", ids: { simkl_id: 3, tmdb: "124905" } }] },
          "/lists/7": { error: "premium_only" },
        },
      );
      const premiumRows = await new SimklService(
        pro,
        store,
        () => undefined,
        () => now,
      ).rows();
      expect(premiumRows.map((row) => row.title)).toEqual([
        "Trending Movies on Simkl This Week",
        "MonsterVerse (Movies)",
      ]);
      expect(premiumRows[1]).toMatchObject({ kind: "list", link: "https://simkl.com/lists/5/" });
    } finally {
      db.close();
    }
  });
});

describe("Simkl ratings", () => {
  it("sends 1-10 ratings and removals to Simkl only with write access", async () => {
    const { db, store } = memoryStore();
    try {
      store.replace("TV", [
        {
          type: "TV",
          simklId: 4,
          tmdbId: 1399,
          status: "completed",
          rating: 9,
          watchedEpisodes: 73,
          updatedAt: "x",
        },
      ]);
      const post = vi.fn(async () => ({ not_found: { movies: [], shows: [] } }));
      const client = {
        connected: true,
        getState: (): SimklAuthState => ({ status: "connected", canWrite: true }),
        get: vi.fn(async () => activities("t1")),
        post,
        getPublic: vi.fn(),
        accountId: 1,
        titleLink: (type: string, id: number) => `link:${type}:${id}`,
      };
      const service = new SimklService(
        client,
        store,
        () => undefined,
        () => now,
      );
      expect(service.ratingFor({ type: "TV", tmdbId: 1399 })).toBe(9);
      expect(service.titleLink({ type: "TV", tmdbId: 1399 })).toBe("link:TV:1399");
      expect(await service.setRating({ type: "MOVIE", tmdbId: 27205 }, 8)).toBe(true);
      expect(await service.setRating({ type: "TV", tmdbId: 1399 }, undefined)).toBe(true);
      expect(post.mock.calls).toEqual([
        ["/sync/ratings", { movies: [{ ids: { tmdb: "27205" }, rating: 8 }] }],
        ["/sync/ratings/remove", { shows: [{ ids: { tmdb: "1399" } }] }],
      ]);
      post.mockResolvedValueOnce({ not_found: { movies: [{ ids: { tmdb: "1" } }] } });
      await expect(service.setRating({ type: "MOVIE", tmdbId: 1 }, 5)).rejects.toThrow(
        /does not know/,
      );
    } finally {
      db.close();
    }
  });
});
