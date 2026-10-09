import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_PREFERENCES,
  parseAppPreferences,
  preferredAudioSource,
} from "../../src/renderer/src/app-preferences";

describe("parseAppPreferences", () => {
  it("returns the defaults for missing or malformed storage", () => {
    expect(parseAppPreferences(undefined)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(parseAppPreferences("on")).toEqual(DEFAULT_APP_PREFERENCES);
    expect(parseAppPreferences([true])).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("keeps valid fields and replaces only the invalid ones", () => {
    expect(
      parseAppPreferences({
        upNext: false,
        schedule: "no",
        forYou: false,
        startSection: "MORE",
        audio: "dub",
        reduceMotion: true,
        heroRotate: 0,
      }),
    ).toEqual({
      upNext: false,
      schedule: true,
      forYou: false,
      latestUpdates: true,
      heroRotate: true,
      reduceMotion: true,
      startSection: "MORE",
      audio: "dub",
    });
    expect(parseAppPreferences({ startSection: "PROFILE", audio: "raw" })).toMatchObject({
      startSection: "ANIME",
      audio: "sub",
    });
  });
});

describe("preferredAudioSource", () => {
  const sources = [
    { id: "a", label: "Subtitles" },
    { id: "b", label: "English dub" },
  ];

  it("picks the embed matching the preferred audio", () => {
    expect(preferredAudioSource(sources, "dub")?.id).toBe("b");
    expect(preferredAudioSource(sources, "sub")?.id).toBe("a");
  });

  it("falls back to the first embed when none matches", () => {
    expect(preferredAudioSource([{ id: "x", label: "Japanese" }], "dub")?.id).toBe("x");
    expect(preferredAudioSource([], "sub")).toBeUndefined();
  });
});
