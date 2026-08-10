import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListDashboard,
  AniListEntry,
} from "../../src/shared/contracts";
import type { ViewerAccess } from "../../src/renderer/src/viewer-access";

const trending: AniListCatalogMedia = {
  id: 101,
  type: "ANIME",
  title: "Trending title",
  coverUrl: "https://example.test/trending.jpg",
  bannerUrl: "https://example.test/trending-banner.jpg",
  description: "Public title details.",
  genres: ["Action"],
  siteUrl: "https://anilist.co/anime/101",
};

const continuingEntry: AniListEntry = {
  id: 501,
  status: "CURRENT",
  score: 0,
  progress: 2,
  progressVolumes: 0,
  repeat: 0,
  updatedAt: 100,
  media: {
    id: 202,
    type: "ANIME",
    title: "Continue title",
    coverUrl: "https://example.test/continue.jpg",
    totalProgress: 12,
    genres: [],
    siteUrl: "https://anilist.co/anime/202",
  },
};

const dashboard: AniListDashboard = {
  profile: {
    id: 1,
    name: "viewer",
    avatarUrl: "",
    siteUrl: "https://anilist.co/user/viewer",
    animeCount: 1,
    episodesWatched: 2,
    minutesWatched: 48,
    mangaCount: 0,
    chaptersRead: 0,
    volumesRead: 0,
  },
  animeLists: [{ name: "Watching", isCustomList: false, entries: [continuingEntry] }],
  mangaLists: [],
  fetchedAt: "2026-08-02T00:00:00.000Z",
};

vi.mock("../../src/renderer/src/useCatalogData", () => ({
  useCatalogData: () => ({
    page: 1,
    latestPage: 1,
    searchResults: undefined,
    trending: [trending],
    malTrendingFallback: [],
    trendingLoading: false,
    latestAnime: [],
    latestManga: [],
    latestPageInfo: undefined,
    latestLoading: false,
    latestError: undefined,
    mangaAvailability: new Map(),
    availabilityNow: Date.now(),
    loading: false,
    error: undefined,
    setSearchPage: vi.fn(),
    setLatestPage: vi.fn(),
  }),
}));

import { CatalogView } from "../../src/renderer/src/CatalogView";
import { MediaDetailModal } from "../../src/renderer/src/MediaDetailModal";

const guestAccess: ViewerAccess = { kind: "guest" };
const memberAccess: ViewerAccess = {
  kind: "member",
  dashboard,
  libraryEntries: new Map([[continuingEntry.media.id, continuingEntry]]),
  addToLibrary: vi.fn(),
  updateEntry: vi.fn(),
  removeFromLibrary: vi.fn(),
  refreshLibrary: vi.fn(),
};

function renderCatalog(access: ViewerAccess): string {
  return renderToStaticMarkup(
    React.createElement(CatalogView, {
      type: "ANIME",
      searchQuery: "",
      access,
      onSelect: vi.fn(),
      onPrimary: vi.fn(),
    }),
  );
}

describe("guest personalization boundary", () => {
  it("keeps public discovery but hides Continue and list controls for guests", () => {
    const markup = renderCatalog(guestAccess);

    expect(markup).toContain("Trending anime");
    expect(markup).toContain("Latest Anime Updates");
    expect(markup).not.toContain("Continue Watching");
    expect(markup).not.toContain("Add Trending title to your list");
  });

  it("restores Continue and list controls for a connected viewer", () => {
    const markup = renderCatalog(memberAccess);

    expect(markup).toContain("Continue Watching");
    expect(markup).toContain("Add Trending title to your list");
  });

  it("keeps public Watch available while hiding detail mutations for guests", () => {
    const guestMarkup = renderToStaticMarkup(
      React.createElement(MediaDetailModal, {
        media: trending,
        access: guestAccess,
        onClose: vi.fn(),
      }),
    );
    const memberMarkup = renderToStaticMarkup(
      React.createElement(MediaDetailModal, {
        media: trending,
        access: memberAccess,
        onClose: vi.fn(),
      }),
    );

    expect(guestMarkup).toContain("Watch");
    expect(guestMarkup).not.toContain("Add to AniList planning");
    expect(memberMarkup).toContain("Add to AniList planning");
  });
});
