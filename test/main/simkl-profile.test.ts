import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ipcArgValidators, isPicturePaletteUrl } from "../../src/main/ipc-validation";
import { paletteFromBitmap } from "../../src/main/picture-palette";
import { simklAvatarUrl } from "../../src/main/simkl/client";
import {
  createSimklLibraryStore,
  parseSimklItems,
  simklPosterUrl,
} from "../../src/main/simkl/library";
import { parseStats, parseTitleRatings } from "../../src/main/simkl/service";

describe("Simkl profile data", () => {
  it("keeps only simkl.in avatars and asks for the 512 px size", () => {
    expect(simklAvatarUrl("https://simkl.in/avatars/12/12345678abcdef9/user_100.jpg")).toBe(
      "https://simkl.in/avatars/12/12345678abcdef9/user_512.jpg",
    );
    expect(simklAvatarUrl("https://simkl.in/avatars/12/abc/user.jpg")).toBe(
      "https://simkl.in/avatars/12/abc/user_512.jpg",
    );
    expect(simklAvatarUrl("https://evil.example/avatars/1/a.jpg")).toBeUndefined();
    expect(simklAvatarUrl("http://simkl.in/avatars/1/a.jpg")).toBeUndefined();
    expect(simklAvatarUrl("https://simkl.in/posters/1/a.jpg")).toBeUndefined();
    expect(simklAvatarUrl(42)).toBeUndefined();
  });

  it("reads posters, years and episode totals from the library", () => {
    const [show] = parseSimklItems(
      {
        shows: [
          {
            status: "watching",
            watched_episodes_count: 7,
            total_episodes_count: 38,
            last_watched_at: "2026-10-01T10:00:00Z",
            show: {
              title: "The Bear",
              poster: "97/978264e8bbc2303",
              year: 2022,
              ids: { simkl: 11121, tmdb: "136315" },
            },
          },
          {
            status: "completed",
            show: { title: "Bad", poster: "../../x", year: 99, ids: { simkl: 5 } },
          },
        ],
      },
      "TV",
    );
    expect(show).toMatchObject({
      poster: "97/978264e8bbc2303",
      year: 2022,
      totalEpisodes: 38,
      watchedEpisodes: 7,
    });
    expect(simklPosterUrl(show?.poster)).toBe(
      "https://simkl.in/posters/97/978264e8bbc2303_ca.webp",
    );
    const bad = parseSimklItems(
      {
        shows: [{ status: "completed", show: { poster: "../../x", year: 99, ids: { simkl: 5 } } }],
      },
      "TV",
    )[0];
    expect(bad?.poster).toBeUndefined();
    expect(bad?.year).toBeUndefined();
  });

  it("adds the new columns to an old library table and forces one full re-pull", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE simkl_library_v1 (
        media_type TEXT NOT NULL, simkl_id INTEGER NOT NULL, tmdb_id INTEGER, title TEXT,
        status TEXT NOT NULL, rating INTEGER, watched_episodes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL, PRIMARY KEY (media_type, simkl_id));
      INSERT INTO simkl_library_v1 VALUES ('MOVIE', 1, 10, 'Old', 'completed', 8, 1, '2026-01-01T00:00:00Z');
      INSERT INTO app_meta VALUES ('simkl.activities.v1', '{"all":"x"}');`);
    const store = createSimklLibraryStore(db);
    expect(store.snapshot()).toBeUndefined();
    expect(store.rows()[0]).toMatchObject({ title: "Old", poster: undefined });
    store.upsert([
      {
        type: "MOVIE",
        simklId: 1,
        tmdbId: 10,
        title: "Old",
        status: "completed",
        watchedEpisodes: 1,
        poster: "12/abcdef12",
        year: 2001,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(store.rows()[0]).toMatchObject({ poster: "12/abcdef12", year: 2001 });
    // A second open does not drop the snapshot again.
    store.saveSnapshot({ all: "y" }, 1);
    createSimklLibraryStore(db);
    expect(store.snapshot()).toEqual({ all: "y", movies: undefined, tv_shows: undefined });
  });

  it("parses watch-time stats and ignores junk", () => {
    expect(
      parseStats({
        total_mins: 999,
        movies: { total_mins: 24_720 },
        tv: {
          total_mins: 106_000,
          watching: { watched_episodes_count: 120 },
          completed: { watched_episodes_count: 2_200 },
          hold: { watched_episodes_count: "x" },
        },
      }),
    ).toEqual({ totalMinutes: 130_720, movieMinutes: 24_720, tvMinutes: 106_000, episodes: 2_320 });
    expect(parseStats(null)).toBeUndefined();
  });

  it("reads Simkl and IMDb scores and builds the IMDb link only from a valid ID", () => {
    expect(
      parseTitleRatings(
        {
          ids: { simkl: 250822, imdb: "tt0816692" },
          ratings: { simkl: { rating: 8.66, votes: 15898 }, imdb: { rating: 8.7, votes: 2616937 } },
        },
        "https://api.simkl.com/redirect?x",
      ),
    ).toEqual({
      simkl: { rating: 8.7, votes: 15898 },
      imdb: { rating: 8.7, votes: 2616937 },
      simklUrl: "https://api.simkl.com/redirect?x",
      imdbUrl: "https://www.imdb.com/title/tt0816692/",
    });
    expect(
      parseTitleRatings({ ids: { imdb: "javascript:x" }, ratings: { imdb: { rating: 7 } } }, "u")
        ?.imdbUrl,
    ).toBeUndefined();
    expect(parseTitleRatings({ ratings: { imdb: { rating: 12 } } }, "u")).toBeUndefined();
    expect(parseTitleRatings({}, "u")).toBeUndefined();
  });
});

describe("Profile look IPC", () => {
  it("allows palettes only for AniList and Simkl avatar hosts", () => {
    expect(isPicturePaletteUrl("https://s4.anilist.co/file/anilistcdn/user/avatar/a.png")).toBe(
      true,
    );
    expect(isPicturePaletteUrl("https://simkl.in/avatars/1/a_512.jpg")).toBe(true);
    expect(isPicturePaletteUrl("https://simkl.in/posters/1/a.jpg")).toBe(false);
    expect(isPicturePaletteUrl("https://example.com/a.png")).toBe(false);
    expect(isPicturePaletteUrl("http://s4.anilist.co/a.png")).toBe(false);
    expect(() => ipcArgValidators["profile:palette"](["https://example.com/a.png"])).toThrow();
  });

  it("accepts only bounded JPEG bytes for the hero", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    expect(ipcArgValidators["profile:hero-set"]([jpeg])).toEqual([jpeg]);
    expect(() =>
      ipcArgValidators["profile:hero-set"]([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]),
    ).toThrow();
    expect(() => ipcArgValidators["profile:hero-set"](["data"])).toThrow();
    expect(() =>
      ipcArgValidators["profile:hero-set"]([new Uint8Array(4 * 1024 * 1024 + 1).fill(0xff)]),
    ).toThrow();
  });
});

describe("Picture palette", () => {
  it("returns one vivid colour per third", () => {
    // 3×1 BGRA: red, green, blue.
    const bitmap = new Uint8Array([0, 0, 200, 255, 0, 200, 0, 255, 200, 0, 0, 255]);
    const [left, middle, right] = paletteFromBitmap(bitmap, 3, 1);
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return r! > g! && r! > b! ? "r" : g! > b! ? "g" : "b";
    };
    expect([hue(left), hue(middle), hue(right)]).toEqual(["r", "g", "b"]);
  });

  it("falls back to brand green for a transparent band", () => {
    expect(paletteFromBitmap(new Uint8Array(12), 3, 1)).toEqual(["#369d73", "#369d73", "#369d73"]);
  });
});
