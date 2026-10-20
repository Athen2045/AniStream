import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AniListCatalogMedia } from "../../src/shared/contracts";
import {
  airedEpisodeCount,
  episodeRangesLabel,
  missingAiredEpisodes,
  airingOutlook,
  episodeAiringLabel,
  formatCountdown,
  titleReleaseNotice,
  unairedEpisode,
} from "../../src/renderer/src/airing";
import { AnimeWatchExperience } from "../../src/renderer/src/AnimeWatchExperience";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const IN_ONE_DAY = Math.floor(NOW / 1000) + 86_400;

describe("airing availability", () => {
  it("blocks the next scheduled episode and everything after it, not earlier ones", () => {
    const media = {
      type: "ANIME" as const,
      status: "RELEASING",
      nextAiringEpisode: { episode: 8, airingAt: IN_ONE_DAY },
    };
    expect(unairedEpisode(media, 7, NOW)).toBeUndefined();
    expect(unairedEpisode(media, 8, NOW)).toEqual({ airingAt: IN_ONE_DAY });
    expect(unairedEpisode(media, 9, NOW)).toEqual({});
  });

  it("uses exact upcoming airing rows for later episodes", () => {
    const media = {
      type: "ANIME" as const,
      status: "RELEASING",
      nextAiringEpisode: { episode: 8, airingAt: IN_ONE_DAY },
      upcomingEpisodes: [{ episode: 9, airingAt: IN_ONE_DAY + 7 * 86_400 }],
    };
    expect(unairedEpisode(media, 9, NOW)).toEqual({ airingAt: IN_ONE_DAY + 7 * 86_400 });
  });

  it("treats a stale next-airing time as aired rather than blocking a released episode", () => {
    const media = {
      type: "ANIME" as const,
      status: "RELEASING",
      nextAiringEpisode: { episode: 8, airingAt: Math.floor(NOW / 1000) - 60 },
    };
    expect(unairedEpisode(media, 8, NOW)).toBeUndefined();
  });

  it("blocks every episode of a title that is not yet released", () => {
    const media = { type: "ANIME" as const, status: "NOT_YET_RELEASED" };
    expect(unairedEpisode(media, 1, NOW)).toEqual({});
    expect(episodeAiringLabel({}, NOW)).toBe("Not aired yet");
    expect(episodeAiringLabel({ airingAt: IN_ONE_DAY }, NOW)).toMatch(/^Airs /);
  });

  it("describes when an unreleased title arrives, from exact time down to no date", () => {
    expect(titleReleaseNotice({ type: "ANIME", status: "RELEASING" }, NOW)).toBeUndefined();
    expect(
      titleReleaseNotice(
        {
          type: "ANIME",
          status: "NOT_YET_RELEASED",
          nextAiringEpisode: { episode: 1, airingAt: IN_ONE_DAY },
        },
        NOW,
      ),
    ).toMatch(/^Airs on .+\d/);
    expect(
      titleReleaseNotice(
        { type: "ANIME", status: "NOT_YET_RELEASED", startDate: "2027-01-12" },
        NOW,
      ),
    ).toMatch(/^Airs on .*2027/);
    expect(
      titleReleaseNotice({ type: "MANGA", status: "NOT_YET_RELEASED", startDate: "2027-04" }, NOW),
    ).toMatch(/^Releases in .*2027/);
    expect(
      titleReleaseNotice({ type: "MANGA", status: "NOT_YET_RELEASED", startDate: "2027" }, NOW),
    ).toBe("Releases in 2027");
    expect(titleReleaseNotice({ type: "ANIME", status: "NOT_YET_RELEASED" }, NOW)).toBe(
      "Air date not announced yet",
    );
  });

  it("formats short countdowns", () => {
    const at = (minutes: number) => Math.floor(NOW / 1000) + minutes * 60;
    expect(formatCountdown(at(5), NOW)).toBe("in 5m");
    expect(formatCountdown(at(134), NOW)).toBe("in 2h 14m");
    expect(formatCountdown(at(60 * 24 * 3 + 60 * 4), NOW)).toBe("in 3d 4h");
    expect(formatCountdown(at(-1), NOW)).toBe("now");
  });
});

describe("episode browser airing blocks", () => {
  it("renders unaired episodes as disabled tiles instead of play buttons", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const media: AniListCatalogMedia = {
      id: 1,
      type: "ANIME",
      title: "Seasonal Show",
      coverUrl: "https://example.test/cover.jpg",
      status: "RELEASING",
      totalProgress: 3,
      nextAiringEpisode: { episode: 3, airingAt: IN_ONE_DAY },
      genres: [],
      siteUrl: "https://anilist.co/anime/1",
    };
    const markup = renderToStaticMarkup(
      React.createElement(AnimeWatchExperience, {
        media,
        initialEpisode: 1,
        onEpisodeWatched: vi.fn(),
      }),
    );
    vi.useRealTimers();

    expect(markup).toContain("Play episode 2");
    expect(markup).not.toContain("Play episode 3");
    expect(markup).toMatch(/Episode 3: Episode 3\. Airs /);
    expect(markup).toContain("is-upcoming");
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Episode 3|aria-label="Episode 3[^>]*disabled=""/,
    );
  });
});

describe("airing outlook", () => {
  const start = Math.floor(NOW / 1000) + 3_600;
  const week = 7 * 86_400;

  it("lists future airings soonest first, marks the finale, and spots a weekly slot", () => {
    const outlook = airingOutlook(
      {
        type: "ANIME",
        status: "RELEASING",
        totalProgress: 4,
        nextAiringEpisode: { episode: 2, airingAt: start },
        upcomingEpisodes: [
          { episode: 1, airingAt: start - week },
          { episode: 4, airingAt: start + 2 * week + 1_800 },
          { episode: 3, airingAt: start + week },
          { episode: 2, airingAt: start },
        ],
      },
      NOW,
      "en-US",
    );
    expect(outlook?.rows.map((row) => [row.episode, row.final])).toEqual([
      [2, false],
      [3, false],
      [4, true],
    ]);
    expect(outlook?.cadence).toMatch(/^Weekly on \w+day at /);
  });

  it("gives no cadence for irregular gaps and nothing for manga or finished titles", () => {
    const irregular = airingOutlook(
      {
        type: "ANIME",
        status: "RELEASING",
        upcomingEpisodes: [
          { episode: 5, airingAt: start },
          { episode: 6, airingAt: start + 3 * 86_400 },
          { episode: 7, airingAt: start + week },
        ],
      },
      NOW,
    );
    expect(irregular?.rows).toHaveLength(3);
    expect(irregular?.cadence).toBeUndefined();
    const manga = { type: "MANGA" as const, nextAiringEpisode: { episode: 1, airingAt: start } };
    expect(airingOutlook(manga, NOW)).toBeUndefined();
    expect(airingOutlook({ type: "ANIME", status: "FINISHED" }, NOW)).toBeUndefined();
  });
});

describe("aired episode count", () => {
  const now = Date.UTC(2026, 9, 20);
  const at = (offsetHours: number) => Math.floor(now / 1000) + offsetHours * 3600;
  it("counts from the next scheduled episode, or the full run once finished", () => {
    const releasing = (airingAt: number) =>
      airedEpisodeCount(
        { type: "ANIME", status: "RELEASING", nextAiringEpisode: { episode: 4, airingAt } },
        now,
      );
    expect(releasing(at(5))).toBe(3);
    expect(releasing(at(-1))).toBe(4);
    expect(airedEpisodeCount({ type: "ANIME", status: "FINISHED", totalProgress: 10 }, now)).toBe(
      10,
    );
    expect(airedEpisodeCount({ type: "ANIME", status: "NOT_YET_RELEASED" }, now)).toBe(0);
    expect(
      airedEpisodeCount({ type: "ANIME", status: "HIATUS", totalProgress: 24 }, now),
    ).toBeUndefined();
  });
});

describe("aired episodes missing from the source", () => {
  it("names the gaps, allows the next-airing tile, and skips other numbering", () => {
    expect(missingAiredEpisodes([1], 10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(missingAiredEpisodes([1, 3, 4], 5)).toEqual([2, 5]);
    expect(missingAiredEpisodes([1, 2, 3, 4], 3)).toEqual([]);
    expect(missingAiredEpisodes([13, 14], 12)).toEqual([]);
    expect(missingAiredEpisodes([1, 2], undefined)).toEqual([]);
  });

  it("writes episode numbers as compact ranges", () => {
    expect(episodeRangesLabel([2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe("2–10");
    expect(episodeRangesLabel([2, 5])).toBe("2, 5");
    expect(episodeRangesLabel([29, 30, 31, 33])).toBe("29–31, 33");
  });
});
