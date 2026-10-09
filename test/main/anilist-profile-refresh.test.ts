import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AniListProfile } from "../../src/shared/contracts";

const session = vi.hoisted(() => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
  isMissingFileError: () => false,
}));
vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../../src/main/anilist/session-store", () => session);

const { AniListClient } = await import("../../src/main/anilist/client");

const saved: AniListProfile = {
  id: 7,
  name: "Viewer",
  avatarUrl: "https://s4.anilist.co/file/anilistcdn/user/avatar/large/b7-old.png",
  bannerUrl: "https://s4.anilist.co/file/anilistcdn/user/banner/b7-old.jpg",
  siteUrl: "https://anilist.co/user/Viewer",
  animeCount: 1,
  episodesWatched: 1,
  minutesWatched: 24,
  mangaCount: 0,
  chaptersRead: 0,
  volumesRead: 0,
};

const viewer = (patch: Record<string, unknown> = {}) => ({
  id: 7,
  name: "Viewer",
  avatar: { large: "https://s4.anilist.co/file/anilistcdn/user/avatar/large/b7-new.png" },
  bannerImage: "https://s4.anilist.co/file/anilistcdn/user/banner/b7-new.jpg",
  siteUrl: "https://anilist.co/user/Viewer",
  statistics: {
    anime: { count: 1, episodesWatched: 1, minutesWatched: 24 },
    manga: { count: 0, chaptersRead: 0, volumesRead: 0 },
  },
  ...patch,
});

function dashboardResponse(viewerValue: unknown): Response {
  return Response.json({
    data: { viewer: viewerValue, anime: { lists: [] }, manga: { lists: [] } },
  });
}

async function signedInClient(emit = vi.fn()) {
  session.loadSession.mockResolvedValue({
    session: { token: "token", profile: saved },
    shouldReEncrypt: false,
  });
  const client = new AniListClient("session.bin", emit);
  await client.restore();
  return { client, emit };
}

describe("AniList profile refresh", () => {
  beforeEach(() => {
    session.saveSession.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the saved profile with the dashboard's current Viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => dashboardResponse(viewer())),
    );
    const { client, emit } = await signedInClient();

    const dashboard = await client.getDashboard();

    expect(dashboard.profile.avatarUrl).toContain("b7-new.png");
    expect(dashboard.profile.bannerUrl).toContain("b7-new.jpg");
    expect(client.getState()).toMatchObject({ status: "signed-in", profile: dashboard.profile });
    expect(emit).toHaveBeenCalledWith({ status: "signed-in", profile: dashboard.profile });
    expect(session.saveSession).toHaveBeenCalledWith("session.bin", {
      token: "token",
      profile: dashboard.profile,
    });
  });

  it("keeps the saved profile when the Viewer is unchanged, malformed or another account", async () => {
    for (const value of [
      viewer({
        avatar: { large: saved.avatarUrl },
        bannerImage: saved.bannerUrl,
      }),
      { id: 7 },
      viewer({ id: 8 }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => dashboardResponse(value)),
      );
      const { client, emit } = await signedInClient();
      const dashboard = await client.getDashboard();
      expect(dashboard.profile).toEqual(saved);
      expect(emit).not.toHaveBeenCalled();
      expect(session.saveSession).not.toHaveBeenCalled();
    }
  });
});
