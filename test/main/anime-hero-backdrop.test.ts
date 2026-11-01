import { describe, expect, it, vi } from "vitest";
import { animeHeroBackdrop } from "../../src/main/anime-hero-backdrop";

describe("anime title page backdrop", () => {
  const links: Record<number, string[]> = { 1: ["TV:100"], 2: ["MOVIE:200", "TV:100"], 3: [] };
  const backdrop = vi.fn(
    async (id: number, type: string) => `https://image.tmdb.org/${type}/${id}.jpg`,
  );
  const deps = { tmdbKeysFor: (id: number) => links[id] ?? [], backdrop };

  it("uses the linked show for a series and the linked film for a movie", async () => {
    await expect(animeHeroBackdrop(deps, { aniListId: 1, movie: false })).resolves.toBe(
      "https://image.tmdb.org/TV/100.jpg",
    );
    await expect(animeHeroBackdrop(deps, { aniListId: 2, movie: true })).resolves.toBe(
      "https://image.tmdb.org/MOVIE/200.jpg",
    );
  });

  it("asks TMDB nothing without a link of the right kind", async () => {
    backdrop.mockClear();
    await expect(animeHeroBackdrop(deps, { aniListId: 3, movie: false })).resolves.toBeUndefined();
    // A movie entry linked only to a show keeps AniList's banner rather than the show's art.
    await expect(animeHeroBackdrop(deps, { aniListId: 1, movie: true })).resolves.toBeUndefined();
    expect(backdrop).not.toHaveBeenCalled();
  });
});
