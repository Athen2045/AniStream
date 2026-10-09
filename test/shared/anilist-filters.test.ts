import { describe, expect, it } from "vitest";
import { parseBrowseFilters } from "../../src/shared/anilist-filters";
import { normalizeFilterOptions } from "../../src/main/anilist/filter-options";

const NOW = new Date(2026, 9, 6);

describe("AniList browse filters", () => {
  it("accepts AniList enum values for the matching media type", () => {
    expect(
      parseBrowseFilters(
        "ANIME",
        {
          format: "TV",
          status: "RELEASING",
          season: "FALL",
          year: 2026,
          country: "JP",
          tag: " Isekai ",
          minScore: 70,
          query: "ignored here",
        },
        NOW,
      ),
    ).toEqual({
      format: "TV",
      status: "RELEASING",
      season: "FALL",
      year: 2026,
      country: "JP",
      tag: "Isekai",
      minScore: 70,
    });
    expect(parseBrowseFilters("MANGA", { format: "NOVEL", country: "KR" }, NOW)).toEqual({
      format: "NOVEL",
      country: "KR",
    });
    expect(parseBrowseFilters("MANGA", {}, NOW)).toEqual({});
  });

  it("rejects values the other media type or AniList would not accept", () => {
    expect(() => parseBrowseFilters("ANIME", { format: "MANGA" }, NOW)).toThrow(/format/);
    expect(() => parseBrowseFilters("MANGA", { format: "TV" }, NOW)).toThrow(/format/);
    expect(() => parseBrowseFilters("MANGA", { season: "FALL" }, NOW)).toThrow(/season/);
    expect(() => parseBrowseFilters("ANIME", { status: "AIRING" }, NOW)).toThrow(/status/);
    expect(() => parseBrowseFilters("ANIME", { year: 1939 }, NOW)).toThrow(/year/);
    expect(() => parseBrowseFilters("ANIME", { year: 2029 }, NOW)).toThrow(/year/);
    expect(() => parseBrowseFilters("ANIME", { year: 2025.5 }, NOW)).toThrow(/year/);
    expect(() => parseBrowseFilters("ANIME", { country: "US" }, NOW)).toThrow(/country/);
    expect(() => parseBrowseFilters("ANIME", { tag: "" }, NOW)).toThrow(/tag/);
    expect(() => parseBrowseFilters("ANIME", { tag: "a\u0000b" }, NOW)).toThrow(/tag/);
    expect(() => parseBrowseFilters("ANIME", { minScore: 100 }, NOW)).toThrow(/score/);
    expect(() => parseBrowseFilters("ANIME", { minScore: "70" }, NOW)).toThrow(/score/);
  });
});

describe("AniList filter options", () => {
  it("keeps well-formed genres and non-adult tags, sorted and de-duplicated", () => {
    expect(
      normalizeFilterOptions({
        GenreCollection: ["Action", "Hentai", "Action", "", 4, "Romance"],
        MediaTagCollection: [
          { name: "Time Skip", category: "Theme-Other", isAdult: false },
          { name: "Isekai", category: "Theme-Fantasy", isAdult: false },
          { name: "Nudity", category: "Sexual Content", isAdult: true },
          { name: "Unknown flag", category: "Theme" },
          { name: "Isekai", isAdult: false },
          { name: 7, isAdult: false },
          null,
        ],
      }),
    ).toEqual({
      genres: ["Action", "Romance"],
      tags: [
        { name: "Isekai", category: "Theme-Fantasy" },
        { name: "Time Skip", category: "Theme-Other" },
      ],
    });
  });

  it("returns empty vocabularies for a malformed response", () => {
    expect(normalizeFilterOptions({ GenreCollection: "Action", MediaTagCollection: {} })).toEqual({
      genres: [],
      tags: [],
    });
  });
});
