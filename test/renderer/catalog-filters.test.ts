import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  browseInput,
  emptyFilters,
  filterKey,
} from "../../src/renderer/src/catalog-filters";

describe("catalog filter state", () => {
  it("builds a browse request with only the chosen filters", () => {
    expect(browseInput("ANIME", 1, 30, "", emptyFilters())).toEqual({
      type: "ANIME",
      page: 1,
      perPage: 30,
      sort: "POPULARITY_DESC",
    });
    expect(
      browseInput("ANIME", 2, 30, "frieren", {
        sort: "SCORE_DESC",
        genre: "Fantasy",
        season: "FALL",
        year: 2023,
        format: "TV",
      }),
    ).toEqual({
      type: "ANIME",
      page: 2,
      perPage: 30,
      query: "frieren",
      sort: "SCORE_DESC",
      genre: "Fantasy",
      season: "FALL",
      year: 2023,
      format: "TV",
    });
  });

  it("counts narrowing filters, not the sort", () => {
    const state = {
      ...emptyFilters(),
      sort: "TRENDING_DESC" as const,
      season: "FALL" as const,
      year: 2025,
      format: "TV" as const,
      genre: "Action",
      minScore: 80,
    };
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount({ ...emptyFilters(), sort: "SCORE_DESC" })).toBe(0);
    expect(activeFilterCount(state)).toBe(5);
    expect(filterKey(state)).not.toBe(filterKey({ ...state, year: 2024 }));
  });
});
