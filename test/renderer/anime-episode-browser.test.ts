import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AniListCatalogMedia } from "../../src/shared/contracts";
import { AnimeWatchExperience } from "../../src/renderer/src/AnimeWatchExperience";

describe("anime episode browser", () => {
  it("keeps fallback episode artwork and duration without repeating the series synopsis", () => {
    const media: AniListCatalogMedia = {
      id: 5114,
      type: "ANIME",
      title: "Fullmetal Alchemist: Brotherhood",
      coverUrl: "https://example.test/series-cover.jpg",
      bannerUrl: "https://example.test/series-banner.jpg",
      description: "Series synopsis that must not be repeated for each episode.",
      totalProgress: 2,
      genres: ["Action"],
      siteUrl: "https://anilist.co/anime/5114",
    };

    const markup = renderToStaticMarkup(
      React.createElement(AnimeWatchExperience, {
        media,
        initialEpisode: 1,
        onEpisodeWatched: vi.fn(),
      }),
    );

    expect(markup).toContain("Play episode 1");
    expect(markup).toContain("Play episode 2");
    expect(markup).toContain("series-banner.jpg");
    expect(markup).toContain("24m");
    expect(markup).not.toContain("Series synopsis that must not be repeated");
    expect(markup).not.toContain("series-cover.jpg");
  });
});
