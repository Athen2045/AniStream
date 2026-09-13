import { describe, expect, it, vi } from "vitest";
import type { AniListMediaDetail, AniListRelation } from "../../src/shared/contracts";
import {
  buildAnimeSeasonChain,
  inferDisplayedPartNumber,
  inferDisplayedSeasonNumber,
  inferMediaDisplayedSeasonNumber,
} from "../../src/renderer/src/anime-season-chain";

function anime(
  id: number,
  title: string,
  options: {
    episodes?: number;
    format?: string;
    seasonYear?: number;
    relations?: AniListRelation[];
  } = {},
): AniListMediaDetail {
  return {
    id,
    type: "ANIME",
    title,
    coverUrl: `https://example.test/${id}.jpg`,
    genres: [],
    siteUrl: `https://anilist.co/anime/${id}`,
    totalProgress: options.episodes,
    format: options.format ?? "TV",
    seasonYear: options.seasonYear,
    synonyms: [],
    studios: [],
    producers: [],
    characters: [],
    staff: [],
    relations: options.relations ?? [],
    recommendations: [],
    externalLinks: [],
  };
}

function relation(relationType: "PREQUEL" | "SEQUEL", media: AniListMediaDetail): AniListRelation {
  return { relationType, media };
}

describe("anime season chain", () => {
  it("walks exact prequel and sequel relations into ascending season order", async () => {
    const season1 = anime(1, "Story", { episodes: 25, seasonYear: 2020 });
    const season2 = anime(2, "Story Season 2", { episodes: 13, seasonYear: 2022 });
    const season3 = anime(3, "Story Season 3", { episodes: 12, seasonYear: 2024 });
    season1.relations = [relation("SEQUEL", season2)];
    season2.relations = [relation("PREQUEL", season1), relation("SEQUEL", season3)];
    season3.relations = [relation("PREQUEL", season2)];
    const details = new Map([
      [season1.id, season1],
      [season2.id, season2],
      [season3.id, season3],
    ]);
    const load = vi.fn(async (id: number) => details.get(id)!);

    const result = await buildAnimeSeasonChain(season2, load);

    expect(result.map((item) => [item.number, item.media.id, item.episodeCount])).toEqual([
      [1, 1, 25],
      [2, 2, 13],
      [3, 3, 12],
    ]);
    expect(load.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining([1, 3]));
  });

  it("prefers a main TV continuation over OVA and short-form branches", async () => {
    const current = anime(10, "Story", { episodes: 12, seasonYear: 2020 });
    const ova = anime(11, "Story OVA", { episodes: 1, format: "OVA", seasonYear: 2021 });
    const short = anime(12, "Story Shorts", {
      episodes: 12,
      format: "TV_SHORT",
      seasonYear: 2021,
    });
    const sequel = anime(13, "Story Season 2", { episodes: 12, format: "TV", seasonYear: 2022 });
    current.relations = [
      relation("SEQUEL", ova),
      relation("SEQUEL", short),
      relation("SEQUEL", sequel),
    ];

    const result = await buildAnimeSeasonChain(current, async (id) => {
      if (id !== sequel.id) throw new Error("Non-series relation selected");
      return sequel;
    });

    expect(result.map((item) => item.media.id)).toEqual([current.id, sequel.id]);
  });

  it("stops relation cycles and never adds the same AniList ID twice", async () => {
    const one = anime(21, "Cycle", { episodes: 12 });
    const two = anime(22, "Cycle 2", { episodes: 12 });
    one.relations = [relation("SEQUEL", two), relation("PREQUEL", two)];
    two.relations = [relation("PREQUEL", one), relation("SEQUEL", one)];
    const result = await buildAnimeSeasonChain(one, async (id) => (id === one.id ? one : two));

    expect(result.map((item) => item.media.id)).toEqual([one.id, two.id]);
  });

  it("infers an immediately useful season number from common title forms", () => {
    expect(inferDisplayedSeasonNumber("Re:ZERO -Starting Life in Another World- Season 4")).toBe(4);
    expect(inferDisplayedSeasonNumber("Mob Psycho 100 III")).toBe(3);
    expect(inferDisplayedSeasonNumber("Re:Zero kara Hajimeru Isekai Seikatsu 4th Season")).toBe(4);
    expect(inferDisplayedSeasonNumber("The Final Season Part 2")).toBeUndefined();
    expect(inferDisplayedPartNumber("Story 2nd Season Part 2")).toBe(2);
  });

  it("uses every normalized AniList title variant before falling back to season one", () => {
    const detail = anime(30, "Re:ZERO -Starting Life in Another World-");
    detail.titleRomaji = "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season";
    detail.titleEnglish = "Re:ZERO Season 4";
    detail.synonyms = ["Re:Zero IV"];

    expect(inferMediaDisplayedSeasonNumber(detail)).toBe(4);
    expect(inferMediaDisplayedSeasonNumber(anime(31, "Story"))).toBeUndefined();
  });

  it("keeps split cours in their logical season and numbers their parts", async () => {
    const first = anime(31, "Story", { episodes: 25 });
    const secondPart1 = anime(32, "Story 2nd Season", { episodes: 13 });
    const secondPart2 = anime(33, "Story 2nd Season Part 2", { episodes: 12 });
    const third = anime(34, "Story 3rd Season", { episodes: 16 });
    first.relations = [relation("SEQUEL", secondPart1)];
    secondPart1.relations = [relation("PREQUEL", first), relation("SEQUEL", secondPart2)];
    secondPart2.relations = [relation("PREQUEL", secondPart1), relation("SEQUEL", third)];
    third.relations = [relation("PREQUEL", secondPart2)];
    const details = new Map(
      [first, secondPart1, secondPart2, third].map((item) => [item.id, item]),
    );

    const result = await buildAnimeSeasonChain(third, async (id) => details.get(id)!);

    expect(result.map(({ number, partNumber }) => [number, partNumber])).toEqual([
      [1, undefined],
      [2, 1],
      [2, 2],
      [3, undefined],
    ]);
  });

  it("keeps a titled part in the preceding implicit season", async () => {
    const third = anime(41, "Story 3rd Season", { episodes: 22 });
    const finalPart1 = anime(42, "Story: The Final Season", { episodes: 16 });
    const finalPart2 = anime(43, "Story: The Final Season Part 2", { episodes: 12 });
    third.relations = [relation("SEQUEL", finalPart1)];
    finalPart1.relations = [relation("PREQUEL", third), relation("SEQUEL", finalPart2)];
    finalPart2.relations = [relation("PREQUEL", finalPart1)];
    const details = new Map([third, finalPart1, finalPart2].map((item) => [item.id, item]));

    const result = await buildAnimeSeasonChain(finalPart2, async (id) => details.get(id)!);

    expect(result.map(({ number, partNumber }) => [number, partNumber])).toEqual([
      [3, undefined],
      [4, 1],
      [4, 2],
    ]);
  });
});
