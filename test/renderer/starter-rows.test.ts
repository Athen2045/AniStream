import { describe, expect, it } from "vitest";
import {
  aniListStarterRows,
  animeSeason,
  dailyPick,
  defaultGenre,
  genreChoices,
  genreRowInput,
  moreStarterRows,
} from "../../src/renderer/src/starter-rows";
import { MORE_GENRES } from "../../src/shared/more-filters";
import { parseBrowseFilters } from "../../src/shared/anilist-filters";

const october = new Date(2026, 9, 20, 12).getTime();
const day = 86_400_000;

describe("starter rows", () => {
  it("names AniList's current and next season, rolling into the next year", () => {
    expect(animeSeason(october)).toEqual({ season: "FALL", year: 2026 });
    expect(animeSeason(october, 1)).toEqual({ season: "WINTER", year: 2027 });
    expect(animeSeason(new Date(2026, 0, 5).getTime())).toEqual({ season: "WINTER", year: 2026 });
  });

  it("picks distinct entries that hold all day and change the next day", () => {
    const list = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const today = dailyPick(list, 3, october);
    expect(new Set(today).size).toBe(3);
    expect(dailyPick(list, 3, october + 3_600_000)).toEqual(today);
    expect(dailyPick(list, 3, october + day)).not.toEqual(today);
  });

  it("asks AniList only for filters it accepts, with distinct rows per section", () => {
    for (const type of ["ANIME", "MANGA"] as const) {
      const rows = aniListStarterRows(type, october);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
      for (const row of rows) expect(() => parseBrowseFilters(type, row.input)).not.toThrow();
    }
    const anime = aniListStarterRows("ANIME", october);
    expect(anime[0]).toMatchObject({ title: "Airing this season", kicker: "Fall 2026" });
    expect(anime.find((row) => row.id === "next-season")?.kicker).toBe("Winter 2027");
    // Manga rows stay with comics; light novels are another format.
    expect(aniListStarterRows("MANGA", october).every((row) => row.input.format !== "NOVEL")).toBe(
      true,
    );
  });

  it("gives More rows with genres each type has", () => {
    for (let offset = 0; offset < 30; offset += 1) {
      const rows = moreStarterRows(october + offset * day);
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((row) => row.id)).size).toBe(5);
      const genres = rows.flatMap((row) => (row.input.genre ? [row.input.genre] : []));
      expect(new Set(genres).size).toBe(genres.length);
    }
  });

  it("opens the Genre row on a genre the starter rows are not already showing", () => {
    for (let offset = 0; offset < 30; offset += 1) {
      const now = october + offset * day;
      for (const type of ["ANIME", "MANGA"] as const) {
        const genre = defaultGenre(type, now);
        expect(genreChoices(type)).toContain(genre);
        const starter = aniListStarterRows(type, now).flatMap((row) =>
          row.input.genre ? [row.input.genre] : [],
        );
        expect(starter).not.toContain(genre);
        expect(() => parseBrowseFilters(type, genreRowInput(type, genre))).not.toThrow();
      }
      const more = defaultGenre("MORE", now);
      expect(moreStarterRows(now).map((row) => row.input.genre)).not.toContain(more);
    }
  });

  it("asks TMDB for movies when the genre has them, else shows, with names it accepts", () => {
    const names = MORE_GENRES.map((genre) => genre.name);
    for (const genre of genreChoices("MORE")) expect(names).toContain(genre);
    expect(genreRowInput("MORE", "Horror")).toMatchObject({ type: "MOVIE", genre: "Horror" });
    expect(genreRowInput("MORE", "Kids").type).toBe("TV");
  });
});
