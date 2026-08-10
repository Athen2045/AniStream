import { describe, expect, it, vi } from "vitest";
import type {
  AniListAuthState,
  AniListDashboard,
  AniListListEntrySummary,
} from "../../src/shared/contracts";
import {
  createViewerSession,
  type ViewerSessionBridge,
} from "../../src/renderer/src/viewer-session";

function dashboard(profileId: number): AniListDashboard {
  return {
    profile: {
      id: profileId,
      name: `viewer-${profileId}`,
      avatarUrl: "",
      siteUrl: `https://anilist.co/user/${profileId}`,
      animeCount: 0,
      episodesWatched: 0,
      minutesWatched: 0,
      mangaCount: 0,
      chaptersRead: 0,
      volumesRead: 0,
    },
    animeLists: [],
    mangaLists: [],
    fetchedAt: new Date().toISOString(),
  };
}

function bridge(overrides: Partial<ViewerSessionBridge> = {}): ViewerSessionBridge {
  const signedOut: AniListAuthState = { status: "signed-out" };
  return {
    getAniListAuthState: vi.fn(async () => signedOut),
    onAniListAuthChanged: vi.fn(() => () => undefined),
    startAniListLogin: vi.fn(async () => undefined),
    cancelAniListLogin: vi.fn(async () => undefined),
    logoutAniList: vi.fn(async () => undefined),
    getCachedAniListDashboard: vi.fn(async () => undefined),
    getAniListDashboard: vi.fn(async () => dashboard(1)),
    addAniListEntry: vi.fn(
      async () =>
        ({
          id: 1,
          status: "CURRENT",
          score: 0,
          progress: 0,
        }) as AniListListEntrySummary,
    ),
    updateAniListEntry: vi.fn(
      async () =>
        ({
          id: 1,
          status: "CURRENT",
          score: 0,
          progress: 0,
        }) as AniListListEntrySummary,
    ),
    deleteAniListEntry: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ViewerSessionModule", () => {
  it("restores signed-out state as guest access", async () => {
    const session = createViewerSession(bridge());

    await session.restore();

    expect(session.getSnapshot().auth).toEqual({ status: "signed-out" });
    expect(session.getSnapshot().access.kind).toBe("guest");
    session.dispose();
  });

  it("ignores cached dashboards belonging to another profile", async () => {
    const auth: AniListAuthState = {
      status: "signed-in",
      profile: dashboard(1).profile,
    };
    const getAniListDashboard = vi.fn(async () => dashboard(1));
    const session = createViewerSession(
      bridge({
        getAniListAuthState: vi.fn(async () => auth),
        getCachedAniListDashboard: vi.fn(async () => dashboard(2)),
        getAniListDashboard,
      }),
    );

    await session.restore();

    expect(session.getSnapshot().access.kind).toBe("member");
    if (session.getSnapshot().access.kind !== "member") throw new Error("Expected member access");
    expect(session.getSnapshot().access.dashboard.profile.id).toBe(1);
    expect(getAniListDashboard).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("clears access immediately and ignores an in-flight refresh after logout", async () => {
    const auth: AniListAuthState = {
      status: "signed-in",
      profile: dashboard(1).profile,
    };
    let resolveDashboard: ((value: AniListDashboard) => void) | undefined;
    const getAniListDashboard = vi
      .fn<() => Promise<AniListDashboard>>()
      .mockResolvedValueOnce(dashboard(1))
      .mockImplementationOnce(
        () => new Promise<AniListDashboard>((resolve) => (resolveDashboard = resolve)),
      );
    const session = createViewerSession(
      bridge({
        getAniListAuthState: vi.fn(async () => auth),
        getCachedAniListDashboard: vi.fn(async () => dashboard(1)),
        getAniListDashboard,
      }),
    );

    await session.restore();
    const refresh = session.refresh();
    await session.logout();
    resolveDashboard?.(dashboard(1));
    await refresh;

    expect(session.getSnapshot().access.kind).toBe("guest");
    expect(session.getSnapshot().auth.status).toBe("signed-out");
    session.dispose();
  });
});
