import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase, type AppDatabase } from "../../src/main/database";
import { parseMoreTitleSnapshot } from "../../src/main/more-library";

const opened: Array<{ directory: string; database: AppDatabase }> = [];

afterEach(() => {
  for (const { directory, database } of opened.splice(0)) {
    database.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

function openDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), "anistream-more-library-"));
  const database = openAppDatabase(join(directory, "anistream.sqlite"));
  opened.push({ directory, database });
  return database;
}

const show = {
  id: 100088,
  type: "TV" as const,
  title: "Sample Show",
  posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
  backdropUrl: "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
  year: 2023,
  score: 8.6,
};
const movie = { id: 27205, type: "MOVIE" as const, title: "Sample Movie" };

describe("More local library", () => {
  it("adds, orders, and removes watch-list titles", () => {
    const database = openDatabase();
    database.setMoreWatchlist(show, true);
    database.setMoreWatchlist(movie, true);
    expect(database.getMoreLibrary().watchlist.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Sample Show", "Sample Movie"]),
    );
    expect(database.getMoreLibrary().watchlist.find((item) => item.id === show.id)).toMatchObject({
      posterUrl: show.posterUrl,
      siteUrl: "https://www.themoviedb.org/tv/100088",
    });
    database.setMoreWatchlist(show, false);
    expect(database.getMoreLibrary().watchlist.map((item) => item.id)).toEqual([movie.id]);
  });

  it("lists the latest unfinished progress per remembered title", () => {
    const database = openDatabase();
    database.rememberMoreTitle(show);
    database.rememberMoreTitle(movie);
    database.saveMorePlaybackResume({
      tmdbId: show.id,
      type: "TV",
      season: 1,
      episode: 2,
      positionSeconds: 3_000,
      durationSeconds: 3_000,
    });
    database.saveMorePlaybackResume({
      tmdbId: show.id,
      type: "TV",
      season: 1,
      episode: 3,
      positionSeconds: 600,
      durationSeconds: 3_000,
    });
    database.saveMorePlaybackResume({
      tmdbId: movie.id,
      type: "MOVIE",
      positionSeconds: 7_000,
      durationSeconds: 7_200,
    });
    // Unremembered titles never surface: there is no metadata to show for them.
    database.saveMorePlaybackResume({
      tmdbId: 9,
      type: "MOVIE",
      positionSeconds: 10,
      durationSeconds: 100,
    });

    const { continueWatching } = database.getMoreLibrary();
    expect(continueWatching).toHaveLength(1);
    expect(continueWatching[0]).toMatchObject({
      item: { id: show.id, title: "Sample Show" },
      season: 1,
      episode: 3,
      positionSeconds: 600,
    });
    expect(
      database.getMoreTitleProgress({ tmdbId: show.id, type: "TV" }).map((entry) => entry.episode),
    ).toEqual(expect.arrayContaining([2, 3]));
  });

  it("rejects snapshots that point outside the TMDB image CDN", () => {
    expect(parseMoreTitleSnapshot(show)).toEqual(show);
    expect(
      parseMoreTitleSnapshot({ ...show, posterUrl: "https://evil.example/x.jpg" }),
    ).toBeUndefined();
    expect(
      parseMoreTitleSnapshot({ ...show, posterUrl: "https://image.tmdb.org/t/p/w500/../x.jpg" }),
    ).toBeUndefined();
    expect(parseMoreTitleSnapshot({ ...show, id: -1 })).toBeUndefined();
    expect(parseMoreTitleSnapshot({ ...show, type: "ANIME" })).toBeUndefined();
    expect(parseMoreTitleSnapshot({ ...show, title: " " })).toBeUndefined();
    const database = openDatabase();
    expect(() => database.setMoreWatchlist({ ...show, score: 99 }, true)).toThrow(/Invalid/);
  });

  it("marks titles completed, keeps ratings, and feeds both into history", () => {
    const database = openDatabase();
    database.setMoreWatchlist(movie, true);
    database.setMoreCompleted(movie, true);
    database.setMoreRating(show, 9);
    const library = database.getMoreLibrary();
    expect(library.watchlist).toEqual([]);
    expect(library.completed).toEqual([{ type: "MOVIE", tmdbId: movie.id }]);
    expect(database.getMoreRating({ type: "TV", tmdbId: show.id })).toBe(9);
    const history = database.listMoreHistory();
    expect(history.find((entry) => entry.tmdbId === movie.id)?.trackerStatus).toBe("completed");
    expect(history.find((entry) => entry.tmdbId === show.id)?.rating).toBe(9);
    database.setMoreRating(show, undefined);
    expect(database.getMoreRating({ type: "TV", tmdbId: show.id })).toBeUndefined();
    expect(() => database.setMoreRating(show, 11)).toThrow(/1 to 10/);
  });

  it("accepts Simkl CDN posters from Simkl rows", () => {
    const poster = "https://simkl.in/posters/20/2036989114a175eae4_m.webp";
    expect(parseMoreTitleSnapshot({ ...movie, posterUrl: poster })?.posterUrl).toBe(poster);
    expect(
      parseMoreTitleSnapshot({ ...movie, posterUrl: "https://simkl.in/avatars/1/x_m.webp" }),
    ).toBeUndefined();
  });
});
