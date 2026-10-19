import { describe, expect, it } from "vitest";
import { normalizeActivityInput } from "../../src/shared/activity";

const media = {
  id: 20954,
  type: "ANIME",
  title: "A Silent Voice",
  coverUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20954.jpg",
  siteUrl: "https://anilist.co/anime/20954",
  totalProgress: 1,
  format: "MOVIE",
};

describe("activity snapshot", () => {
  it("keeps the wide banner and format for Continue cards", () => {
    const banner = "https://s4.anilist.co/file/anilistcdn/media/anime/banner/20954.jpg";
    const input = normalizeActivityInput({
      media: { ...media, bannerUrl: banner, description: "not kept" },
      unit: 1,
      state: "started",
    });
    expect(input.media).toMatchObject({ bannerUrl: banner, format: "MOVIE" });
    expect(input.media).not.toHaveProperty("description");
  });

  it("leaves the banner out when there is none and refuses a non-https one", () => {
    expect(normalizeActivityInput({ media, unit: 1, state: "started" }).media).not.toHaveProperty(
      "bannerUrl",
    );
    expect(() =>
      normalizeActivityInput({
        media: { ...media, bannerUrl: "http://example.com/banner.jpg" },
        unit: 1,
        state: "started",
      }),
    ).toThrow();
  });
});
