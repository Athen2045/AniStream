import { afterEach, describe, expect, it } from "vitest";
import { normalizeCatalogMedia } from "../../src/main/anilist/normalize";
import {
  chooseAniListTitle,
  setPreferEnglishTitles,
} from "../../src/main/anilist/title-preference";
import { parseTitlePreferences } from "../../src/main/title-preferences-store";

const media = {
  id: 1,
  type: "ANIME",
  title: {
    userPreferred: "Shingeki no Kyojin",
    english: "Attack on Titan",
    romaji: "Shingeki no Kyojin",
  },
  coverImage: { large: "https://s4.anilist.co/1.jpg" },
  siteUrl: "https://anilist.co/anime/1",
};

afterEach(() => setPreferEnglishTitles(true));

describe("AniList title preference", () => {
  it("shows English by default and AniList's preferred title when turned off", () => {
    expect(normalizeCatalogMedia(media, "ANIME").title).toBe("Attack on Titan");
    setPreferEnglishTitles(false);
    expect(normalizeCatalogMedia(media, "ANIME").title).toBe("Shingeki no Kyojin");
  });

  it("falls back when a title has no English name", () => {
    expect(chooseAniListTitle({ userPreferred: "Sousou no Frieren", english: " " })).toBe(
      "Sousou no Frieren",
    );
    expect(chooseAniListTitle({ romaji: "Only Romaji" })).toBe("Only Romaji");
    expect(chooseAniListTitle({})).toBeUndefined();
  });

  it("validates the stored preference", () => {
    expect(parseTitlePreferences({ english: false })).toEqual({ english: false });
    expect(() => parseTitlePreferences({ english: "yes" })).toThrow();
  });
});
