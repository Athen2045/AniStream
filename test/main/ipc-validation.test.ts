import { describe, expect, it } from "vitest";
import { ipcArgValidators } from "../../src/main/ipc-validation";
import {
  isValidMangaReadingResumeInput,
  isValidPlaybackResumeInput,
} from "../../src/shared/resume-validation";

describe("IPC argument validation", () => {
  it("bounds production recommendation feedback and impressions", () => {
    expect(ipcArgValidators["discovery:for-you"](["ANIME"])).toEqual(["ANIME"]);
    expect(() =>
      ipcArgValidators["discovery:feedback"]([
        { requestId: "valid-id", anilistId: 1, action: "started" },
      ]),
    ).toThrow();
    expect(() =>
      ipcArgValidators["discovery:impressions"]([
        { requestId: "valid-id", anilistIds: Array(11).fill(1) },
      ]),
    ).toThrow();
    expect(() =>
      ipcArgValidators["discovery:feedback"]([
        { requestId: "../bad", anilistId: 1, action: "dismiss" },
      ]),
    ).toThrow();
  });
  it("accepts only a boolean for window caption visibility", () => {
    expect(ipcArgValidators["window:caption-controls"]([false])).toEqual([false]);
    expect(() => ipcArgValidators["window:caption-controls"](["false"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["window:caption-controls"]([])).toThrow(/malformed/);
  });
  it("rejects the wrong argument count for a no-arg channel", () => {
    expect(() => ipcArgValidators["app:get-info"]([])).not.toThrow();
    expect(() => ipcArgValidators["app:get-info"](["unexpected"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anime:provider-readiness"]([])).not.toThrow();
    expect(() => ipcArgValidators["anime:provider-readiness"](["unexpected"])).toThrow(/malformed/);
  });

  it("rejects positional args with the wrong primitive type or value", () => {
    expect(ipcArgValidators["anilist:media-detail"]([1, "ANIME"])).toEqual([1, "ANIME"]);
    expect(() => ipcArgValidators["anilist:media-detail"](["1", "ANIME"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:media-detail"]([1, "MOVIE"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:latest-anime"]([0])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:latest-anime"]([1.5])).toThrow(/malformed/);
    expect(ipcArgValidators["anilist:latest-anime"]([1])).toEqual([1]);
  });

  it("rejects non-object input where a shaped record is required", () => {
    expect(() => ipcArgValidators["anilist:browse"](["not-an-object"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:browse"]([["ANIME"]])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:browse"]([{ type: "ANIME" }])).toThrow(/malformed/);
  });

  it("accepts a fully-populated shaped record and drops nothing valid", () => {
    const [input] = ipcArgValidators["anilist:browse"]([
      { type: "ANIME", page: 2, perPage: 20, query: "one", genre: "Action", sort: "SCORE_DESC" },
    ]);
    expect(input).toEqual({
      type: "ANIME",
      page: 2,
      perPage: 20,
      query: "one",
      genre: "Action",
      sort: "SCORE_DESC",
    });
  });

  it("passes validated catalog filters and rejects ones AniList would not accept", () => {
    const [input] = ipcArgValidators["anilist:browse"]([
      { type: "ANIME", page: 1, format: "TV", season: "FALL", year: 2025, minScore: 70 },
    ]);
    expect(input).toEqual({
      type: "ANIME",
      page: 1,
      format: "TV",
      season: "FALL",
      year: 2025,
      minScore: 70,
    });
    expect(() =>
      ipcArgValidators["anilist:browse"]([{ type: "MANGA", page: 1, season: "FALL" }]),
    ).toThrow(/malformed/);
    expect(() =>
      ipcArgValidators["anilist:browse"]([{ type: "ANIME", page: 1, format: "NOVEL" }]),
    ).toThrow(/malformed/);
    expect(ipcArgValidators["anilist:filter-options"]([])).toEqual([]);
    expect(() => ipcArgValidators["anilist:filter-options"]([1])).toThrow(/malformed/);
  });

  it("rejects an unrecognized enum value on an otherwise-valid record", () => {
    expect(() =>
      ipcArgValidators["anilist:browse"]([{ type: "ANIME", page: 1, sort: "RANDOM" }]),
    ).toThrow(/malformed/);
  });

  it("rejects a malformed array element rather than dropping it silently", () => {
    expect(() =>
      ipcArgValidators["mangadex:availability"]([[{ aniListId: 1, title: "One Piece" }, {}]]),
    ).toThrow(/malformed/);
    expect(
      ipcArgValidators["mangadex:availability"]([[{ aniListId: 1, title: "One Piece" }]]),
    ).toEqual([[{ aniListId: 1, title: "One Piece" }]]);
  });

  it("rejects a string list containing a non-string element", () => {
    expect(() =>
      ipcArgValidators["anime:episode-catalog"]([{ aniListId: 1, titles: ["ok", 2] }]),
    ).toThrow(/malformed/);
    expect(
      ipcArgValidators["anime:episode-catalog"]([{ aniListId: 1, titles: ["One Piece"] }]),
    ).toEqual([
      {
        aniListId: 1,
        titles: ["One Piece"],
        seasonLabel: undefined,
        totalEpisodes: undefined,
      },
    ]);
  });

  it("allows a zero page index for MangaDex reader pages but rejects negative ones", () => {
    expect(ipcArgValidators["mangadex:page"]([{ chapterId: "abc", page: 0 }])).toEqual([
      { chapterId: "abc", page: 0, quality: undefined },
    ]);
    expect(() => ipcArgValidators["mangadex:page"]([{ chapterId: "abc", page: -1 }])).toThrow(
      /malformed/,
    );
  });

  it("rejects an out-of-enum quality on a MangaDex page request", () => {
    expect(() =>
      ipcArgValidators["mangadex:page"]([{ chapterId: "abc", page: 0, quality: "high" }]),
    ).toThrow(/malformed/);
  });

  it("validates explicit MangaDex language and group preferences", () => {
    expect(
      ipcArgValidators["manga:save-reader-preferences"]([
        { aniListId: 30_013, translatedLanguage: "JA", preferredGroupId: "group-uuid" },
      ]),
    ).toEqual([{ aniListId: 30_013, translatedLanguage: "ja", preferredGroupId: "group-uuid" }]);
    for (const translatedLanguage of ["all", "pt-br", "es"]) {
      expect(() =>
        ipcArgValidators["manga:save-reader-preferences"]([
          { aniListId: 30_013, translatedLanguage },
        ]),
      ).toThrow(/malformed/);
    }
  });

  it("accepts fractional manga scroll checkpoints and rejects out-of-range progress", () => {
    expect(
      isValidMangaReadingResumeInput({
        aniListId: 30_013,
        chapterId: "chapter_1188",
        chapterNumber: 1188,
        progress: 0.42,
      }),
    ).toBe(true);
    expect(
      isValidMangaReadingResumeInput({
        aniListId: 30_013,
        chapterId: "chapter_1188",
        progress: 1.01,
      }),
    ).toBe(false);
  });

  it("rejects playback checkpoints that violate persistence invariants", () => {
    expect(
      isValidPlaybackResumeInput({
        aniListId: 1,
        episode: 0,
        positionSeconds: 0,
        durationSeconds: 24,
      }),
    ).toBe(false);
    expect(
      isValidPlaybackResumeInput({
        aniListId: 1,
        episode: 1,
        positionSeconds: 120,
        durationSeconds: 24,
      }),
    ).toBe(false);
  });

  it("validates More catalog and player arguments", () => {
    expect(ipcArgValidators["more:trending"](["MOVIE", 1])).toEqual(["MOVIE", 1]);
    expect(ipcArgValidators["more:search"](["Inception", "MOVIE", 1])).toEqual([
      "Inception",
      "MOVIE",
      1,
    ]);
    expect(
      ipcArgValidators["more:player-prepare"]([
        { tmdbId: 27205, type: "MOVIE", startAtSeconds: 120.9 },
      ]),
    ).toEqual([{ tmdbId: 27205, type: "MOVIE", startAtSeconds: 120 }]);
    expect(
      ipcArgValidators["more:player-prepare"]([
        { tmdbId: 93405, type: "TV", season: 1, episode: 2 },
      ]),
    ).toEqual([{ tmdbId: 93405, type: "TV", season: 1, episode: 2 }]);
    expect(() =>
      ipcArgValidators["more:player-prepare"]([
        { tmdbId: 93405, type: "TV", season: 0, episode: 1 },
      ]),
    ).toThrow(/malformed/);
    expect(() =>
      ipcArgValidators["more:player-prepare"]([
        { tmdbId: 27205, type: "MOVIE", startAtSeconds: -1 },
      ]),
    ).toThrow(/malformed/);
    expect(
      ipcArgValidators["more:player-prepare"]([{ tmdbId: 27205, type: "MOVIE", providerIndex: 1 }]),
    ).toEqual([{ tmdbId: 27205, type: "MOVIE", providerIndex: 1 }]);
    for (const providerIndex of [-1, 1.5, 32, "1"])
      expect(() =>
        ipcArgValidators["more:player-prepare"]([{ tmdbId: 27205, type: "MOVIE", providerIndex }]),
      ).toThrow(/malformed/);
    expect(ipcArgValidators["more:player-release"]([])).toEqual([]);
    expect(() => ipcArgValidators["more:player-release"](["x"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["more:search"](["", "MOVIE", 1])).toThrow(/malformed/);
  });

  it("validates More seasons and local library arguments", () => {
    const title = {
      id: 100088,
      type: "TV",
      title: "Sample Show",
      posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
    };
    expect(ipcArgValidators["more:season"]([100088, 0])).toEqual([100088, 0]);
    expect(() => ipcArgValidators["more:season"]([100088, 501])).toThrow(/malformed/);
    expect(() => ipcArgValidators["more:season"]([0, 1])).toThrow(/malformed/);
    expect(ipcArgValidators["more:library"]([])).toEqual([]);
    expect(
      ipcArgValidators["more:title-progress"]([{ tmdbId: 5, type: "MOVIE", extra: 1 }]),
    ).toEqual([{ tmdbId: 5, type: "MOVIE" }]);
    expect(ipcArgValidators["more:watchlist-set"]([title, true])).toEqual([title, true]);
    expect(() => ipcArgValidators["more:watchlist-set"]([title, "yes"])).toThrow(/malformed/);
    expect(() =>
      ipcArgValidators["more:remember"]([{ ...title, backdropUrl: "file:///C:/secret.jpg" }]),
    ).toThrow(/malformed/);
    expect(ipcArgValidators["more:remember"]([title])).toEqual([title]);
  });
});
