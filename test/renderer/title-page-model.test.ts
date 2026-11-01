import { describe, expect, it } from "vitest";
import type { AniListCatalogMedia, AniListMediaDetail, MalScore } from "../../src/shared/contracts";
import {
  airedEpisodes,
  animeScores,
  primaryActionLabel,
  titleCopy,
} from "../../src/renderer/src/title-page-model";

const media: AniListCatalogMedia = {
  id: 1,
  type: "MANGA",
  title: "Example",
  genres: [],
  siteUrl: "https://anilist.co/manga/1",
};

describe("title page copy", () => {
  it("fills AniList's gaps from MyAnimeList and credits what it filled", () => {
    const mal = {
      synopsis: "<b>From MAL</b>",
      genres: ["Drama"],
      englishTitle: "Example EN",
    } as MalScore;
    const detail = {
      titleRomaji: "Example",
      titleNative: "例",
      staff: [],
    } as unknown as AniListMediaDetail;
    const copy = titleCopy(media, detail, mal, undefined);
    expect(copy.description).toBe("From MAL");
    expect(copy.genres).toEqual(["Drama"]);
    expect(copy.malFilled).toEqual(["Summary", "English title", "genres"]);
    // The romaji title equals the shown title, so only the others are listed.
    expect(copy.altTitles).toEqual(["Example EN", "例"]);
  });

  it("keeps AniList's own summary and says so when there is none", () => {
    expect(
      titleCopy({ ...media, description: "Own" }, undefined, undefined, undefined),
    ).toMatchObject({ description: "Own", malFilled: [] });
    expect(titleCopy(media, undefined, undefined, undefined).description).toMatch(/does not/);
  });
});

describe("title page actions", () => {
  it("labels Watch, Continue, Read and Resume", () => {
    const base = { watchedEpisodes: 0, nextEpisode: 1, mangaProgress: 0 };
    expect(primaryActionLabel({ ...base, anime: true })).toBe("Watch");
    expect(
      primaryActionLabel({
        ...base,
        anime: true,
        watchedEpisodes: 4,
        nextEpisode: 5,
        totalProgress: 12,
      }),
    ).toBe("Continue E5");
    expect(
      primaryActionLabel({ ...base, anime: true, watchedEpisodes: 12, totalProgress: 12 }),
    ).toBe("Watch");
    expect(primaryActionLabel({ ...base, anime: false })).toBe("Read");
    expect(primaryActionLabel({ ...base, anime: false, mangaProgress: 9 })).toBe("Continue Ch. 10");
    expect(
      primaryActionLabel({
        ...base,
        anime: false,
        mangaResume: { chapterNumber: 10.5, progress: 0.4 } as never,
      }),
    ).toBe("Resume Ch. 10.5");
  });

  it("counts aired episodes for downloads", () => {
    expect(airedEpisodes({ ...media, status: "NOT_YET_RELEASED", totalProgress: 12 })).toBe(0);
    expect(airedEpisodes({ ...media, nextAiringEpisode: { episode: 5, airingAt: 0 } })).toBe(4);
    expect(airedEpisodes({ ...media, totalProgress: 24 })).toBe(24);
  });

  it("orders the anime score pills MyAnimeList first", () => {
    const scores = animeScores(
      { ...media, averageScore: 88 },
      { score: 9.1, scoredBy: 1000, malUrl: "https://myanimelist.net/anime/1" } as MalScore,
      media.siteUrl,
    );
    expect(scores.map((row) => row.source)).toEqual(["mal", "anilist"]);
    expect(scores[1].href).toBe(media.siteUrl);
  });
});
