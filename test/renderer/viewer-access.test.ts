import { describe, expect, it, vi } from "vitest";
import type { AniListDashboard } from "../../src/shared/contracts";
import {
  hasPersonalizedAccess,
  mediaDetailInstanceKey,
  type ViewerAccess,
} from "../../src/renderer/src/viewer-access";

const dashboard: AniListDashboard = {
  profile: {
    id: 1,
    name: "viewer",
    avatarUrl: "",
    siteUrl: "https://anilist.co/user/viewer",
    animeCount: 0,
    episodesWatched: 0,
    minutesWatched: 0,
    mangaCount: 0,
    chaptersRead: 0,
    volumesRead: 0,
  },
  animeLists: [],
  mangaLists: [],
  fetchedAt: "2026-08-02T00:00:00.000Z",
};

describe("viewer access", () => {
  it("keeps signed-out viewers outside personalized capabilities", () => {
    const access: ViewerAccess = { kind: "guest" };

    expect(hasPersonalizedAccess(access)).toBe(false);
    expect("addToLibrary" in access).toBe(false);
  });

  it("exposes list capabilities only for a connected AniList viewer", () => {
    const access: ViewerAccess = {
      kind: "member",
      dashboard,
      libraryEntries: new Map(),
      addToLibrary: vi.fn(),
      removeFromLibrary: vi.fn(),
      refreshLibrary: vi.fn(),
    };

    expect(hasPersonalizedAccess(access)).toBe(true);
    if (!hasPersonalizedAccess(access)) throw new Error("Expected member access.");
    expect(access.dashboard.profile.name).toBe("viewer");
  });

  it("remounts open details when a guest becomes an authenticated viewer", () => {
    const media = { id: 101, type: "ANIME" } as const;
    const guest: ViewerAccess = { kind: "guest" };
    const member: ViewerAccess = {
      kind: "member",
      dashboard,
      libraryEntries: new Map(),
      addToLibrary: vi.fn(),
      removeFromLibrary: vi.fn(),
      refreshLibrary: vi.fn(),
    };

    expect(mediaDetailInstanceKey(media, guest)).not.toBe(mediaDetailInstanceKey(media, member));
  });
});
