import { describe, expect, it } from "vitest";
import type { AniListCatalogMedia, AnimeProviderSeason } from "../../src/shared/contracts";
import {
  catalogSeasonLabel,
  catalogTitles,
  fallbackSeason,
  findEpisode,
  sameEpisode,
  withEpisodeArt,
  withNextAiringTile,
} from "../../src/renderer/src/anime-episode-list";

const media: AniListCatalogMedia = {
  id: 21,
  type: "ANIME",
  title: "Example Show",
  genres: [],
  siteUrl: "https://anilist.co/anime/21",
};

const season = (id: string, numbers: number[]): AnimeProviderSeason => ({
  id,
  number: 1,
  title: id,
  episodes: numbers.map((number) => ({ id: `${id}-${number}`, number })),
});

describe("anime episode list", () => {
  it("opens on the listed episode and the season that holds it", () => {
    const seasons = [season("s1", [1, 2]), season("s2", [3, 4])];
    const found = findEpisode(seasons, 3);
    expect(found.episode.id).toBe("s2-3");
    expect(found.season?.id).toBe("s2");
  });

  it("opens on a placeholder in the first season when the list lacks the episode", () => {
    const found = findEpisode([season("s1", [1, 2])], 9);
    expect(found.episode).toEqual({ id: "", number: 9, title: "Episode 9" });
    expect(found.season?.id).toBe("s1");
  });

  it("matches episodes by id when both have one, else by number", () => {
    expect(sameEpisode({ id: "a", number: 1 }, { id: "b", number: 1 })).toBe(false);
    expect(sameEpisode({ id: "", number: 1 }, { id: "b", number: 1 })).toBe(true);
  });

  it("stands in with AniList's episode count, at least one episode", () => {
    expect(fallbackSeason(media).episodes).toHaveLength(1);
    const airing = fallbackSeason({
      ...media,
      totalProgress: 12,
      nextAiringEpisode: { episode: 5, airingAt: 0 },
    });
    expect(airing.episodes.map((episode) => episode.number)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  it("adds the next airing episode as a locked tile only right after the last listed one", () => {
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const airing = { ...media, nextAiringEpisode: { episode: 3, airingAt: future } };
    const tiled = withNextAiringTile([season("s1", [1, 2])], airing);
    expect(tiled[0].episodes.map((episode) => episode.number)).toEqual([1, 2, 3]);
    expect(withNextAiringTile([season("s1", [1])], airing)[0].episodes).toHaveLength(1);
  });

  it("fills in art without replacing a real title or description", () => {
    const art = {
      number: 1,
      stillUrl: "https://example.test/1.jpg",
      title: "Art title",
      synopsis: "Art",
    };
    expect(withEpisodeArt({ id: "", number: 1, title: "Episode 1" }, art)).toMatchObject({
      thumbnailUrl: art.stillUrl,
      title: "Art title",
      description: "Art",
    });
    expect(
      withEpisodeArt({ id: "", number: 1, title: "The Real Name", description: "Own" }, art),
    ).toMatchObject({ title: "The Real Name", description: "Own" });
  });

  it("searches with distinct non-empty titles and labels the season", () => {
    expect(catalogTitles(media)).toEqual(["Example Show"]);
    expect(catalogSeasonLabel(media)).toBe("Season 1");
    expect(catalogSeasonLabel({ ...media, season: "FALL", seasonYear: 2026 })).toBe("Fall 2026");
  });
});
