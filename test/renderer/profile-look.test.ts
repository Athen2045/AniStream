import { describe, expect, it } from "vitest";
import { cropRect, maxCropZoom } from "../../src/renderer/src/ProfileLookDialog";
import {
  chooseHero,
  choosePicture,
  HERO_RULES,
  parseProfileLook,
} from "../../src/renderer/src/profile-look";

describe("profile look", () => {
  it("parses saved choices and defaults anything unknown", () => {
    expect(parseProfileLook({ picture: "simkl", hero: "custom" })).toEqual({
      picture: "simkl",
      hero: "custom",
    });
    expect(parseProfileLook({ picture: "x", hero: 3 })).toEqual({
      picture: "anilist",
      hero: "auto",
    });
    expect(parseProfileLook(null)).toEqual({ picture: "anilist", hero: "auto" });
  });

  it("shows the chosen picture, else whichever account has one", () => {
    expect(choosePicture("simkl", "a.png", "s.jpg")).toEqual({ url: "s.jpg", source: "simkl" });
    expect(choosePicture("simkl", "a.png", undefined)).toEqual({ url: "a.png", source: "anilist" });
    expect(choosePicture("anilist", undefined, "s.jpg")).toEqual({ url: "s.jpg", source: "simkl" });
    expect(choosePicture("anilist", undefined, undefined)).toEqual({});
  });

  it("uses the AniList banner by default, colours without one, and the own image when set", () => {
    expect(chooseHero("auto", undefined, "b.jpg", "p.png")).toEqual({
      kind: "image",
      url: "b.jpg",
      custom: false,
    });
    expect(chooseHero("auto", undefined, undefined, "p.png")).toEqual({
      kind: "mix",
      pictureUrl: "p.png",
    });
    expect(chooseHero("mix", undefined, "b.jpg", "p.png").kind).toBe("mix");
    expect(chooseHero("custom", "data:x", "b.jpg", "p.png")).toEqual({
      kind: "image",
      url: "data:x",
      custom: true,
    });
    // A custom choice without a saved image falls back like auto.
    expect(chooseHero("custom", undefined, "b.jpg", "p.png")).toMatchObject({ url: "b.jpg" });
  });

  it("crops to the band's shape and moves within the image", () => {
    const wide = cropRect({ width: 3800, height: 1200 }, { x: 0.5, y: 0.5, zoom: 1 });
    expect(wide.w / wide.h).toBeCloseTo(HERO_RULES.aspect);
    expect(wide.w).toBeCloseTo(3800);
    expect(wide.y).toBeCloseTo((1200 - wide.h) / 2);
    const tall = cropRect({ width: 1600, height: 2000 }, { x: 0, y: 1, zoom: 2 });
    expect(tall.w).toBeCloseTo(800);
    expect(tall.x).toBe(0);
    expect(tall.y + tall.h).toBeCloseTo(2000);
  });

  it("never zooms the crop below the minimum hero width", () => {
    expect(maxCropZoom({ width: 1920, height: 1080 })).toBeCloseTo(1.2);
    expect(maxCropZoom({ width: 1600, height: 340 })).toBe(1);
    expect(maxCropZoom({ width: 8000, height: 4000 })).toBe(3);
    const zoom = maxCropZoom({ width: 3000, height: 900 });
    expect(cropRect({ width: 3000, height: 900 }, { x: 0.5, y: 0.5, zoom }).w).toBeCloseTo(1600);
  });
});
