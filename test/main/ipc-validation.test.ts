import { describe, expect, it } from "vitest";
import { ipcArgValidators } from "../../src/main/ipc-validation";

describe("IPC argument validation", () => {
  it("rejects the wrong argument count for a no-arg channel", () => {
    expect(() => ipcArgValidators["app:get-info"]([])).not.toThrow();
    expect(() => ipcArgValidators["app:get-info"](["unexpected"])).toThrow(/malformed/);
  });

  it("rejects positional args with the wrong primitive type or value", () => {
    expect(ipcArgValidators["anilist:search"](["one piece", "ANIME"])).toEqual([
      "one piece",
      "ANIME",
    ]);
    expect(() => ipcArgValidators["anilist:search"]([42, "ANIME"])).toThrow(/malformed/);
    expect(() => ipcArgValidators["anilist:search"](["one piece", "MOVIE"])).toThrow(/malformed/);
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
        fallbackThumbnailUrl: undefined,
        fallbackDescription: undefined,
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

  it("accepts fractional manga scroll checkpoints and rejects out-of-range progress", () => {
    expect(
      ipcArgValidators["manga:save-reading-resume"]([
        { aniListId: 30_013, chapterId: "chapter_1188", chapterNumber: 1188, progress: 0.42 },
      ]),
    ).toEqual([
      { aniListId: 30_013, chapterId: "chapter_1188", chapterNumber: 1188, progress: 0.42 },
    ]);
    expect(() =>
      ipcArgValidators["manga:save-reading-resume"]([
        { aniListId: 30_013, chapterId: "chapter_1188", progress: 1.01 },
      ]),
    ).toThrow(/malformed/);
  });

  it("rejects playback checkpoints that violate persistence invariants", () => {
    expect(() =>
      ipcArgValidators["playback:save-resume"]([
        { aniListId: 1, episode: 0, positionSeconds: 0, durationSeconds: 24 },
      ]),
    ).toThrow(/malformed/);
    expect(() =>
      ipcArgValidators["playback:save-resume"]([
        { aniListId: 1, episode: 1, positionSeconds: 120, durationSeconds: 24 },
      ]),
    ).toThrow(/malformed/);
  });
});
