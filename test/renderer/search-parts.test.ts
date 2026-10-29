import { describe, expect, it, vi } from "vitest";
import type { AniListCatalogMedia, MoreCatalogItem } from "../../src/shared/contracts";
import { catalogFilterChips, moreFilterChips } from "../../src/renderer/src/search-filter-chips";
import { genreArtwork } from "../../src/renderer/src/search-genres";

describe("search filter chips", () => {
  it("lists each Anime/Manga filter and removes only that one", () => {
    const update = vi.fn();
    const chips = catalogFilterChips(
      { sort: "POPULARITY_DESC", genre: "Action", format: "MOVIE", year: 2024, minScore: 70 },
      update,
    );
    expect(chips.map((chip) => chip.label)).toEqual(["Action", "Movie", "2024", "Score 7+"]);
    chips[0].remove();
    expect(update).toHaveBeenCalledWith({
      sort: "POPULARITY_DESC",
      format: "MOVIE",
      year: 2024,
      minScore: 70,
    });
  });

  it("shows a non-default sort as a chip that returns to the default", () => {
    const update = vi.fn();
    const chips = catalogFilterChips({ sort: "SCORE_DESC" }, update);
    expect(chips).toHaveLength(1);
    chips[0].remove();
    expect(update).toHaveBeenCalledWith({ sort: "POPULARITY_DESC" });
  });

  it("names Movies & TV filters by their labels", () => {
    const update = vi.fn();
    const chips = moreFilterChips({ sort: "popular", type: "TV", language: "ml" }, update);
    expect(chips.map((chip) => chip.label)).toEqual(["Shows", "Malayalam"]);
    chips[1].remove();
    expect(update).toHaveBeenCalledWith({ sort: "popular", type: "TV" });
  });
});

describe("genre tile artwork", () => {
  const anime = (id: number, genres: string[], bannerUrl?: string): AniListCatalogMedia => ({
    id,
    type: "ANIME",
    title: `Title ${id}`,
    genres,
    bannerUrl,
    siteUrl: `https://anilist.co/anime/${id}`,
  });

  it("gives each tile a different trending banner, or none rather than a repeat", () => {
    const art = genreArtwork("ANIME", {
      kind: "anilist",
      page: 1,
      hasNext: false,
      items: [
        anime(1, ["Action", "Romance"], "https://example.test/1.jpg"),
        anime(2, ["Romance"], "https://example.test/2.jpg"),
        anime(3, ["Comedy"]),
      ],
    });
    expect(art.get("Action")).toBe("https://example.test/1.jpg");
    expect(art.get("Romance")).toBe("https://example.test/2.jpg");
    expect(art.has("Comedy")).toBe(false);
  });

  it("matches TMDB's Science Fiction to the Sci-Fi tile", () => {
    const show = {
      id: 9,
      type: "TV",
      title: "Show",
      genres: ["Science Fiction"],
      backdropUrl: "https://example.test/b.jpg",
    } as unknown as MoreCatalogItem;
    const art = genreArtwork("MORE", { kind: "more", items: [show] } as never);
    expect(art.get("Sci-Fi")).toBe("https://example.test/b.jpg");
  });
});
