import { describe, expect, it } from "vitest";
import {
  buildPersonalTitles,
  continueTitles,
  personalReleases,
} from "../../src/shared/personal-library";
import type { AniListEntry, AniListMedia } from "../../src/shared/contracts";
import type { LocalActivity } from "../../src/shared/activity";

const media: AniListMedia = {
  id: 10,
  type: "ANIME",
  title: "Example",
  coverUrl: "",
  siteUrl: "https://anilist.co/anime/10",
  totalProgress: 12,
};
const entry: AniListEntry = {
  id: 20,
  media,
  status: "CURRENT",
  progress: 4,
  score: 0,
  repeat: 0,
  updatedAt: 100,
};
const activity: LocalActivity = {
  media,
  unit: 5,
  state: "started",
  completedProgress: 4,
  updatedAt: new Date(200_000).toISOString(),
  syncStatus: "local",
  playbackResume: {
    aniListId: 10,
    episode: 5,
    positionSeconds: 180,
    durationSeconds: 1400,
    updatedAt: new Date(200_000).toISOString(),
  },
};

describe("personal continuation", () => {
  it("retains the newest local row when guest and member history overlap", () => {
    const older = {
      ...activity,
      unit: 2,
      completedProgress: 1,
      updatedAt: new Date(100_000).toISOString(),
    };
    const titles = buildPersonalTitles("ANIME", [], [activity, older]);
    expect(titles[0].local?.unit).toBe(5);
    expect(titles[0].progress).toBe(4);
  });
  it("merges custom-list duplicates and local activity by exact identity", () => {
    const titles = buildPersonalTitles(
      "ANIME",
      [entry, { ...entry, progress: 6, updatedAt: 150 }],
      [activity],
    );
    expect(titles).toHaveLength(1);
    expect(titles[0].progress).toBe(6);
    expect(titles[0].local?.unit).toBe(5);
  });
  it("does not let an older local checkpoint move current AniList progress backwards", () => {
    const staleCheckpoint: LocalActivity = {
      ...activity,
      unit: 1,
      completedProgress: 0,
      playbackResume: { ...activity.playbackResume!, episode: 1 },
    };

    const continuing = continueTitles(
      buildPersonalTitles("ANIME", [entry], [staleCheckpoint]),
      new Map(),
    );

    expect(continuing[0]).toMatchObject({ label: "Continue episode 5", targetUnit: 5 });
  });
  it("keeps a guest checkpoint and an explicit rewatch even when tracker is caught up", () => {
    expect(
      continueTitles(buildPersonalTitles("ANIME", [], [activity]), new Map())[0].label,
    ).toContain("episode 5");
    const completed = { ...entry, status: "COMPLETED" as const, progress: 12 };
    expect(
      continueTitles(buildPersonalTitles("ANIME", [completed], [activity]), new Map()),
    ).toHaveLength(1);
  });
  it("hides completed local titles without discarding them from release candidates", () => {
    const titles = buildPersonalTitles(
      "ANIME",
      [],
      [
        {
          ...activity,
          state: "completed",
          completedProgress: 12,
          unit: 12,
          playbackResume: undefined,
        },
      ],
    );
    expect(titles).toHaveLength(1);
    expect(continueTitles(titles, new Map())).toEqual([]);
  });
  it("bounds personal provider candidates after deduplication", () => {
    expect(
      buildPersonalTitles(
        "ANIME",
        Array.from({ length: 80 }, (_, index) => ({
          ...entry,
          media: { ...media, id: index + 1 },
        })),
        [],
      ),
    ).toHaveLength(24);
  });
});

describe("personal release inbox", () => {
  it("uses actual past airing results, hides consumed and acknowledged units", () => {
    const titles = buildPersonalTitles("ANIME", [entry], []);
    const aired = [{ aniListId: 10, episode: 5, airedAt: 100 }];
    expect(personalReleases(titles, aired, new Map(), [], 200_000)[0]).toMatchObject({
      kind: "aired",
      unit: 5,
      key: "ANIME:10",
    });
    expect(
      personalReleases(titles, aired, new Map(), [{ key: "ANIME:10", unit: 5 }], 200_000),
    ).toEqual([]);
    expect(
      personalReleases(titles, [{ ...aired[0], airedAt: 300 }], new Map(), [], 200_000),
    ).toEqual([]);
  });
  it("never treats an outage or an unmapped manga as an available release", () => {
    const titles = buildPersonalTitles(
      "MANGA",
      [{ ...entry, media: { ...media, type: "MANGA" } }],
      [],
    );
    const unavailable = new Map([
      [
        10,
        {
          aniListId: 10,
          status: "unavailable" as const,
          translatedLanguage: "en",
          latestChapter: 9,
          checkedAt: new Date().toISOString(),
        },
      ],
    ]);
    expect(personalReleases(titles, [], unavailable, [])).toEqual([]);
    const available = new Map([[10, { ...unavailable.get(10)!, status: "available" as const }]]);
    expect(personalReleases(titles, [], available, [])[0]).toMatchObject({
      kind: "translated",
      key: "MANGA:10:en",
      unit: 9,
    });
  });
});
