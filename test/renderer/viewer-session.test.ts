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
    onActivityChanged: vi.fn(() => () => undefined),
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
  it("restores subscriptions after StrictMode cleanup and ignores an older auth result", async () => {
    let resolveOld!: (state: AniListAuthState) => void;
    const oldAuth = new Promise<AniListAuthState>((resolve) => {
      resolveOld = resolve;
    });
    const api = bridge({
      getAniListAuthState: vi
        .fn()
        .mockReturnValueOnce(oldAuth)
        .mockResolvedValue({ status: "signed-in", profile: dashboard(2).profile }),
      getAniListDashboard: async () => dashboard(2),
    });
    const session = createViewerSession(api);
    const oldRestore = session.restore();
    session.dispose();
    session.activate();
    await session.restore();
    resolveOld({ status: "signed-out" });
    await oldRestore;
    expect(session.getSnapshot().access.kind).toBe("member");
    expect(api.onAniListAuthChanged).toHaveBeenCalledTimes(2);
    expect(api.onActivityChanged).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("refreshes completed background sync only for a connected viewer and unsubscribes on exit", async () => {
    let changed: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const getAniListDashboard = vi.fn(async () => dashboard(1));
    const session = createViewerSession(
      bridge({
        getAniListAuthState: async () => ({ status: "signed-in", profile: dashboard(1).profile }),
        getAniListDashboard,
        onActivityChanged: (callback) => {
          changed = callback;
          return unsubscribe;
        },
      }),
    );
    await session.restore();
    changed?.();
    await Promise.resolve();
    expect(getAniListDashboard).toHaveBeenCalledTimes(2);
    await session.logout();
    changed?.();
    expect(getAniListDashboard).toHaveBeenCalledTimes(2);
    session.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("keeps viewer access stable while only refresh status changes", async () => {
    const initial = dashboard(1);
    const refreshed = initial;
    let resolveRefresh!: (value: AniListDashboard) => void;
    const getAniListDashboard = vi
      .fn<() => Promise<AniListDashboard>>()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(
        () => new Promise<AniListDashboard>((resolve) => (resolveRefresh = resolve)),
      );
    const session = createViewerSession(
      bridge({
        getAniListAuthState: async () => ({ status: "signed-in", profile: initial.profile }),
        getCachedAniListDashboard: async () => initial,
        getAniListDashboard,
      }),
    );
    await session.restore();
    const originalAccess = session.getSnapshot().access;
    const refreshSnapshots: ReturnType<typeof session.getSnapshot>[] = [];
    const unsubscribe = session.subscribe(() => refreshSnapshots.push(session.getSnapshot()));

    const refresh = session.refresh();
    expect(refreshSnapshots[0]?.syncing).toBe(true);
    expect(refreshSnapshots[0]?.access).toBe(originalAccess);
    refreshed.fetchedAt = "2026-09-13T00:00:00.000Z";
    resolveRefresh(refreshed);
    await refresh;

    expect(refreshSnapshots[1]?.access).not.toBe(originalAccess);
    expect(refreshSnapshots[2]?.syncing).toBe(false);
    expect(refreshSnapshots[2]?.access).toBe(refreshSnapshots[1]?.access);
    unsubscribe();
    session.dispose();
  });
  it("restores signed-out state as guest access", async () => {
    const session = createViewerSession(bridge());

    await session.restore();

    expect(session.getSnapshot().auth).toEqual({ status: "signed-out" });
    expect(session.getSnapshot().access.kind).toBe("guest");
    session.dispose();
  });

  it("explains profile outages without exposing GraphQL or IPC internals", async () => {
    const session = createViewerSession(
      bridge({
        getAniListAuthState: async () => ({
          status: "signed-in",
          profile: dashboard(1).profile,
        }),
        getAniListDashboard: async () => {
          throw new Error(
            "Error invoking remote method 'anilist:dashboard': malformed GraphQL response",
          );
        },
      }),
    );

    await session.restore();

    expect(session.getSnapshot().error).toBe(
      "AniList returned incomplete data. Try again shortly.",
    );
    expect(session.getSnapshot().access.kind).toBe("member");
    session.dispose();
  });

  it("states that cached profile data remains available when a refresh fails", async () => {
    const cached = dashboard(1);
    const session = createViewerSession(
      bridge({
        getAniListAuthState: async () => ({ status: "signed-in", profile: cached.profile }),
        getCachedAniListDashboard: async () => cached,
        getAniListDashboard: async () => {
          throw new Error("HTTP 503");
        },
      }),
    );

    await session.restore();

    expect(session.getSnapshot().error).toContain("previous library data remain available");
    expect(session.getSnapshot().hasVerifiedDashboard).toBe(true);
    session.dispose();
  });

  it("gives a reconnect path when the saved AniList session cannot be read", async () => {
    const session = createViewerSession(
      bridge({
        getAniListAuthState: async () => {
          throw new Error(
            "Error invoking remote method 'anilist:auth-state': encrypted payload 17",
          );
        },
      }),
    );

    await session.restore();

    expect(session.getSnapshot().error).toBe(
      "The saved AniList connection could not be restored. Connect AniList again from Profile.",
    );
    expect(session.getSnapshot().error).not.toContain("payload");
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
    expect(session.getSnapshot().hasVerifiedDashboard).toBe(true);
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

  it("restores access when the main process cannot complete logout", async () => {
    const auth: AniListAuthState = {
      status: "signed-in",
      profile: dashboard(1).profile,
    };
    const logoutAniList = vi.fn(async () => {
      throw new Error("Keychain unavailable");
    });
    const session = createViewerSession(
      bridge({
        getAniListAuthState: vi.fn(async () => auth),
        getCachedAniListDashboard: vi.fn(async () => dashboard(1)),
        getAniListDashboard: vi.fn(async () => dashboard(1)),
        logoutAniList,
      }),
    );

    await session.restore();
    await session.logout();

    expect(session.getSnapshot().access.kind).toBe("member");
    expect(session.getSnapshot().auth).toEqual(auth);
    expect(session.getSnapshot().error).toBe("Keychain unavailable");
    expect(logoutAniList).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
