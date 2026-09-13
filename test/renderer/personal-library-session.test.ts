import { describe, expect, it, vi } from "vitest";
import { createPersonalLibrarySession } from "../../src/renderer/src/personal-library-session";
import type { LocalActivity } from "../../src/shared/activity";
import type { PersonalAiringUpdate } from "../../src/shared/personal-library";
import type { ViewerAccess } from "../../src/renderer/src/viewer-access";

const activity: LocalActivity[] = ["ANIME", "MANGA"].map((type, index) => ({
  media: {
    id: index + 1,
    type: type as "ANIME" | "MANGA",
    title: `Title ${index}`,
    coverUrl: "",
    siteUrl: "",
    totalProgress: 20,
  },
  unit: 2,
  completedProgress: 1,
  state: "started",
  updatedAt: new Date(1000).toISOString(),
  syncStatus: "local",
}));

function setup() {
  let now = 2_000_000;
  let visible = true;
  const bridge = {
    getLocalActivity: vi.fn(async () => activity),
    getReleaseAcknowledgements: vi.fn(async () => []),
    getPersonalAnimeUpdates: vi.fn(async () => [{ aniListId: 1, episode: 3, airedAt: 1000 }]),
    getMangaDexAvailability: vi.fn(async () => [
      {
        aniListId: 2,
        status: "available" as const,
        translatedLanguage: "en",
        latestChapter: 4,
        checkedAt: new Date(1500000).toISOString(),
      },
    ]),
    acknowledgeRelease: vi.fn(async () => undefined),
    retryActivitySync: vi.fn(async () => activity),
  };
  const session = createPersonalLibrarySession({ kind: "guest" }, bridge, {
    now: () => now,
    visible: () => visible,
  });
  return {
    session,
    bridge,
    advance: (ms: number) => {
      now += ms;
    },
    visible: (value: boolean) => {
      visible = value;
    },
  };
}

describe("shared personal library and notifications", () => {
  it("clears tracker-only titles and ignores their pending updates after sign-out", async () => {
    const { session, bridge } = setup();
    bridge.getLocalActivity.mockResolvedValue([]);
    const member: ViewerAccess = {
      kind: "member",
      dashboard: {
        profile: {
          id: 10,
          name: "Test",
          avatarUrl: "",
          siteUrl: "",
          animeCount: 1,
          episodesWatched: 1,
          minutesWatched: 24,
          mangaCount: 0,
          chaptersRead: 0,
          volumesRead: 0,
        },
        animeLists: [
          {
            name: "Watching",
            isCustomList: false,
            entries: [
              {
                id: 10,
                media: activity[0].media,
                status: "CURRENT",
                progress: 1,
                progressVolumes: 0,
                score: 0,
                repeat: 0,
                updatedAt: 1,
              },
            ],
          },
        ],
        mangaLists: [],
        fetchedAt: new Date().toISOString(),
      },
      libraryEntries: new Map(),
      addToLibrary: vi.fn(),
      updateEntry: vi.fn(),
      removeFromLibrary: vi.fn(),
      refreshLibrary: vi.fn(),
    };
    let finish!: (value: PersonalAiringUpdate[]) => void;
    bridge.getPersonalAnimeUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    session.setAccess(member);
    session.activate();
    await vi.waitFor(() => expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1));
    expect(session.getSnapshot().continuing.ANIME).toHaveLength(1);
    session.setAccess({ kind: "guest" });
    await session.refresh();
    finish([{ aniListId: 1, episode: 3, airedAt: 1000 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().continuing.ANIME).toEqual([]);
    expect(session.getSnapshot().releases).toEqual([]);
    session.dispose();
  });

  it("re-reads local progress when a change arrives during an older read", async () => {
    const { session, bridge } = setup();
    let finish!: (value: LocalActivity[]) => void;
    bridge.getLocalActivity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    session.activate();
    session.invalidateLocal();
    finish([]);
    await session.refresh();
    expect(bridge.getLocalActivity).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().continuing.ANIME).toHaveLength(1);
    session.dispose();
  });

  it("checks changed candidates after an older provider request finishes", async () => {
    const { session, bridge } = setup();
    let finish!: (value: PersonalAiringUpdate[]) => void;
    bridge.getPersonalAnimeUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    session.activate();
    await vi.waitFor(() => expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1));
    bridge.getLocalActivity.mockResolvedValue([
      { ...activity[0], media: { ...activity[0].media, id: 3 } },
    ]);
    session.invalidateLocal();
    await vi.waitFor(() => expect(session.getSnapshot().continuing.ANIME[0].media.id).toBe(3));
    finish([{ aniListId: 1, episode: 19, airedAt: 1000 }]);
    await vi.waitFor(() => expect(bridge.getPersonalAnimeUpdates).toHaveBeenLastCalledWith([3]));
    expect(session.getSnapshot().releases.some((item) => item.media.id === 1)).toBe(false);
    session.dispose();
  });

  it("loads anime and manga together and keeps both Continue rails", async () => {
    const { session } = setup();
    session.activate();
    await session.refresh();
    expect(session.getSnapshot().releases.map((item) => item.kind)).toEqual([
      "translated",
      "aired",
    ]);
    expect(session.getSnapshot().continuing.ANIME).toHaveLength(1);
    expect(session.getSnapshot().continuing.MANGA).toHaveLength(1);
    session.dispose();
  });

  it("coalesces concurrent refreshes and does not refetch providers for checkpoints or dropdown opens", async () => {
    const { session, bridge } = setup();
    session.activate();
    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    expect(bridge.getLocalActivity).toHaveBeenCalledTimes(1);
    await session.refresh();
    await session.refresh();
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1);
    expect(bridge.getMangaDexAvailability).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("refreshes only stale visible provider data and bounds manual refresh", async () => {
    const { session, bridge, advance, visible } = setup();
    session.activate();
    await session.refresh();
    await session.refresh(true);
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1);
    advance(60_000);
    await session.refresh(true);
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(2);
    advance(30 * 60_000);
    visible(false);
    await session.refresh();
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(2);
    visible(true);
    await session.refresh();
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it("marks one release seen durably without changing progress or losing the other type", async () => {
    const { session, bridge } = setup();
    session.activate();
    await session.refresh();
    const progress = session.getSnapshot().continuing;
    expect(await session.acknowledge(session.getSnapshot().releases[0])).toBe(true);
    expect(bridge.acknowledgeRelease).toHaveBeenCalledWith({ key: "MANGA:2:en", unit: 4 });
    await session.refresh();
    expect(session.getSnapshot().releases.map((item) => item.kind)).toEqual(["aired"]);
    expect(session.getSnapshot().continuing).toEqual(progress);
    expect(bridge.retryActivitySync).not.toHaveBeenCalled();
    session.dispose();
  });

  it("preserves unread state on save failure", async () => {
    const { session, bridge } = setup();
    bridge.acknowledgeRelease.mockRejectedValue(new Error("disk"));
    session.activate();
    await session.refresh();
    expect(await session.acknowledge(session.getSnapshot().releases[0])).toBe(false);
    expect(session.getSnapshot().releases).toHaveLength(2);
    expect(session.getSnapshot().error).toContain("Could not mark");
    session.dispose();
  });

  it.each(["timeout", "429", "malformed"])(
    "retains the other provider and surfaces %s failures without retrying",
    async (reason) => {
      const { session, bridge } = setup();
      bridge.getPersonalAnimeUpdates.mockRejectedValue(new Error(reason));
      session.activate();
      await session.refresh();
      await session.refresh();
      expect(session.getSnapshot().releases.map((item) => item.kind)).toEqual(["translated"]);
      expect(session.getSnapshot().error).toContain("Anime update check failed");
      expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1);
      session.dispose();
    },
  );

  it("stays empty and performs no provider work without personal titles", async () => {
    const { session, bridge } = setup();
    bridge.getLocalActivity.mockResolvedValue([]);
    session.activate();
    await session.refresh();
    expect(session.getSnapshot().releases).toEqual([]);
    expect(bridge.getMangaDexAvailability).not.toHaveBeenCalled();
    expect(bridge.getPersonalAnimeUpdates).not.toHaveBeenCalled();
    session.dispose();
  });

  it("ignores a disposed request after development reactivation", async () => {
    const { session, bridge } = setup();
    let finish!: (value: PersonalAiringUpdate[]) => void;
    bridge.getPersonalAnimeUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    session.activate();
    await vi.waitFor(() => expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1));
    session.dispose();
    session.activate();
    await session.refresh();
    finish([{ aniListId: 1, episode: 19, airedAt: 1000 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().releases.find((item) => item.kind === "aired")?.unit).toBe(3);
    session.dispose();
  });

  it("invalidates only manga when reading language changes", async () => {
    const { session, bridge } = setup();
    session.activate();
    await session.refresh();
    session.invalidateManga();
    await session.refresh();
    expect(bridge.getMangaDexAvailability).toHaveBeenCalledTimes(2);
    expect(bridge.getPersonalAnimeUpdates).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
