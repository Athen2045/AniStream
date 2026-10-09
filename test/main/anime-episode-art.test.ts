import { describe, expect, it, vi } from "vitest";
import { animeEpisodeArt, type EpisodeArtDeps } from "../../src/main/anime-episode-art";
import type { MoreDetail, MoreSeasonDetail } from "../../src/shared/contracts";

const artOf = async (...args: Parameters<typeof animeEpisodeArt>) =>
  (await animeEpisodeArt(...args)).art;

const day = (date: string, offset: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** TMDB show: season 1 (12 weekly episodes from 2020-01-01) and season 2 (24 from 2021-04-01). */
function deps(overrides: Partial<EpisodeArtDeps> = {}): EpisodeArtDeps & {
  season: ReturnType<typeof vi.fn>;
} {
  const seasons: Record<number, MoreSeasonDetail> = {
    1: {
      seasonNumber: 1,
      name: "Season 1",
      episodes: Array.from({ length: 12 }, (_, index) => ({
        number: index + 1,
        name: `S1E${index + 1}`,
        airDate: day("2020-01-01", index * 7),
        stillUrl: `https://image.example/s1e${index + 1}.jpg`,
      })),
    },
    2: {
      seasonNumber: 2,
      name: "Season 2",
      episodes: Array.from({ length: 24 }, (_, index) => ({
        number: index + 1,
        name: `S2E${index + 1}`,
        airDate: day("2021-04-01", index * 7),
        stillUrl: index === 3 ? undefined : `https://image.example/s2e${index + 1}.jpg`,
      })),
    },
  };
  const season = vi.fn(async (_id: number, number: number) => seasons[number]);
  return {
    links: () => ({ tmdbKeysFor: () => ["MOVIE:9", "TV:500"], aniListIdsFor: () => [] }),
    media: async () => ({ startDate: "2021-04-01", prequels: [] }),
    detail: async () =>
      ({
        seasons: [
          { number: 0, name: "Specials", episodeCount: 3, airDate: "2019-12-01" },
          { number: 1, name: "Season 1", episodeCount: 12, airDate: "2020-01-01" },
          { number: 2, name: "Season 2", episodeCount: 24, airDate: "2021-04-01" },
        ],
      }) as unknown as MoreDetail,
    season,
    ...overrides,
  };
}

describe("TMDB episode stills for anime", () => {
  it("anchors the AniList entry by start date and skips episodes without a still", async () => {
    const art = await artOf(deps(), { aniListId: 1, episodes: 12, focus: 1 });
    expect(art[0]).toEqual({ number: 1, stillUrl: "https://image.example/s2e1.jpg" });
    expect(art.find((row) => row.number === 4)).toBeUndefined();
    expect(art).toHaveLength(11);
  });

  it("finds a second cour that starts partway through a TMDB season (time-zone tolerant)", async () => {
    const art = await artOf(
      deps({ media: async () => ({ startDate: day("2021-04-01", 12 * 7 + 1), prequels: [] }) }),
      {
        aniListId: 1,
        episodes: 12,
        focus: 1,
      },
    );
    expect(art[0]).toEqual({ number: 1, stillUrl: "https://image.example/s2e13.jpg" });
    expect(art.at(-1)).toEqual({ number: 12, stillUrl: "https://image.example/s2e24.jpg" });
  });

  it("continues across TMDB season boundaries for a long single AniList entry", async () => {
    const art = await artOf(
      deps({ media: async () => ({ startDate: "2020-01-01", prequels: [] }) }),
      {
        aniListId: 1,
        episodes: 30,
        focus: 20,
      },
    );
    expect(art.find((row) => row.number === 13)?.stillUrl).toBe("https://image.example/s2e1.jpg");
  });

  it("keeps the current artwork without an exact date, link or anchor", async () => {
    const input = { aniListId: 1, episodes: 12, focus: 1 };
    expect(
      await artOf(deps({ media: async () => ({ startDate: "2021-04", prequels: [] }) }), input),
    ).toEqual([]);
    expect(
      await artOf(deps({ media: async () => ({ startDate: "2022-09-09", prequels: [] }) }), input),
    ).toEqual([]);
    expect(
      await artOf(
        deps({ links: () => ({ tmdbKeysFor: () => [], aniListIdsFor: () => [] }) }),
        input,
      ),
    ).toEqual([]);
  });

  it("borrows the prequel's series for a season without its own link", async () => {
    const art = await artOf(
      deps({
        links: () => ({
          tmdbKeysFor: (id) => (id === 2 ? ["TV:500"] : []),
          aniListIdsFor: () => [],
        }),
        media: async (id) =>
          id === 1 ? { startDate: "2021-04-01", prequels: [2] } : { prequels: [] },
      }),
      { aniListId: 1, episodes: 12, focus: 1 },
    );
    expect(art[0]?.stillUrl).toBe("https://image.example/s2e1.jpg");
  });

  it("keeps the other seasons' stills when one TMDB season fails, and marks the result partial", async () => {
    const base = deps({ media: async () => ({ startDate: "2020-01-01", prequels: [] }) });
    const result = await animeEpisodeArt(
      {
        ...base,
        season: async (id, number) => {
          if (number === 2) throw new Error("empty response");
          return base.season(id, number);
        },
      },
      { aniListId: 1, episodes: 30, focus: 1 },
    );
    expect(result.complete).toBe(false);
    expect(result.art).toHaveLength(12);
  });
});
