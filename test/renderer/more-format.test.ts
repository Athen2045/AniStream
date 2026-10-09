import { describe, expect, it } from "vitest";
import type { MoreDetail, MoreTitleProgress } from "../../src/shared/contracts";
import {
  formatDuration,
  formatRemaining,
  isUpcoming,
  releaseState,
  resumeTarget,
} from "../../src/renderer/src/more-format";

const show: MoreDetail = {
  id: 1,
  type: "TV",
  title: "Sample Show",
  genres: [],
  siteUrl: "https://www.themoviedb.org/tv/1",
  networks: [],
  creators: [],
  seasons: [
    { number: 0, name: "Specials", episodeCount: 3 },
    { number: 1, name: "Season 1", episodeCount: 2 },
    { number: 2, name: "Season 2", episodeCount: 8 },
  ],
};

function progress(season: number, episode: number, ratio: number): MoreTitleProgress {
  return {
    season,
    episode,
    positionSeconds: ratio * 1_000,
    durationSeconds: 1_000,
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
}

describe("More resume target", () => {
  it("starts a fresh show at its first regular season", () => {
    expect(resumeTarget(show, [])).toEqual({ target: { season: 1, episode: 1 }, mode: "start" });
  });

  it("resumes an unfinished episode", () => {
    expect(resumeTarget(show, [progress(1, 2, 0.4)])).toEqual({
      target: { season: 1, episode: 2 },
      mode: "resume",
    });
  });

  it("moves to the next season after a finished season finale", () => {
    expect(resumeTarget(show, [progress(1, 2, 0.97)])).toEqual({
      target: { season: 2, episode: 1 },
      mode: "next",
    });
  });

  it("treats a movie's finished progress as a fresh start", () => {
    const movie = { ...show, type: "MOVIE" as const, seasons: [] };
    const finished = { ...progress(1, 1, 0.99), season: undefined, episode: undefined };
    expect(resumeTarget(movie, [finished])).toEqual({ mode: "start" });
  });

  it("formats durations and remaining time", () => {
    expect(formatDuration(167)).toBe("2h 47m");
    expect(formatDuration(46)).toBe("46m");
    expect(formatRemaining({ positionSeconds: 1_800, durationSeconds: 4_560 })).toBe("46m left");
  });
});

describe("More release state", () => {
  const today = new Date(2026, 9, 3, 12);

  it("treats future dates as unreleased with an availability label", () => {
    expect(releaseState("2026-12-18", undefined, today)).toEqual({
      unreleased: true,
      label: "Available Dec 18, 2026",
    });
    expect(releaseState("2026-10-03", undefined, today)).toEqual({ unreleased: false });
    expect(releaseState("2024-03-01", "Released", today)).toEqual({ unreleased: false });
  });

  it("uses TMDB status only for undated titles", () => {
    expect(releaseState(undefined, "Post Production", today)).toEqual({
      unreleased: true,
      label: "Release date not announced",
    });
    expect(releaseState(undefined, "Released", today)).toEqual({ unreleased: false });
    expect(releaseState(undefined, undefined, today)).toEqual({ unreleased: false });
  });

  it("flags only episodes that air after today", () => {
    expect(isUpcoming("2026-10-04", today)).toBe(true);
    expect(isUpcoming("2026-10-03", today)).toBe(false);
    expect(isUpcoming(undefined, today)).toBe(false);
  });
});
