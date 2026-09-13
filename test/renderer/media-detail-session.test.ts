import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaTitleSnapshot,
} from "../../src/shared/contracts";
import { createMediaDetailSession } from "../../src/renderer/src/media-detail-session";
import type { MediaDetailSessionBridge } from "../../src/renderer/src/media-detail-session";
import type { ViewerAccess } from "../../src/renderer/src/viewer-access";

const media: AniListCatalogMedia = {
  id: 101,
  type: "ANIME",
  title: "Test title",
  coverUrl: "https://example.test/cover.jpg",
  genres: [],
  siteUrl: "https://anilist.co/anime/101",
};

const mangaMedia: AniListCatalogMedia = {
  ...media,
  id: 202,
  type: "MANGA",
  title: "Test manga",
  siteUrl: "https://anilist.co/manga/202",
};

const detail: AniListMediaDetail = {
  ...media,
  synonyms: [],
  studios: [],
  producers: [],
  characters: [],
  staff: [],
  relations: [],
  recommendations: [],
  externalLinks: [],
  listEntry: { id: 1, status: "CURRENT", score: 0, progress: 1 },
};

const member: ViewerAccess = {
  kind: "member",
  dashboard: {} as never,
  libraryEntries: new Map(),
  addToLibrary: vi.fn(async () => ({ id: 1, status: "CURRENT", score: 0, progress: 0 })),
  updateEntry: vi.fn(async () => ({ id: 1, status: "CURRENT", score: 0, progress: 2 })),
  removeFromLibrary: vi.fn(async () => undefined),
  refreshLibrary: vi.fn(async () => undefined),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const mangaSnapshot: MangaTitleSnapshot = {
  aniListId: mangaMedia.id,
  issues: [],
  reader: {
    status: "available",
    aniListId: mangaMedia.id,
    mangaDexId: "manga-id",
    translatedLanguage: "en",
    availableLanguages: ["en"],
    availableGroups: [],
    archiveStatus: "complete",
    chapters: [
      {
        id: "chapter-1",
        number: 1,
        title: "Chapter 1",
        pages: 20,
        translatedLanguage: "en",
        groups: [],
      },
      {
        id: "chapter-2",
        number: 2,
        title: "Chapter 2",
        pages: 20,
        translatedLanguage: "en",
        groups: [],
      },
    ],
  },
};

function makeSession(overrides: Partial<MediaDetailSessionBridge> = {}) {
  const bridge: MediaDetailSessionBridge = {
    getAniListMediaDetail: vi.fn(async () => ({ ...detail, ...mangaMedia, malId: 42 })),
    getMalScore: vi.fn(async () => undefined),
    getMangaTitleSnapshot: vi.fn(async () => mangaSnapshot),
    cancelRequest: vi.fn(async () => undefined),
    getMangaReadingResume: vi.fn(async () => undefined),
    saveMangaReaderPreferences: async (input) => ({ ...input, updatedAt: "today" }),
    recordActivity: async (input) => ({
      ...input,
      completedProgress: input.unit,
      updatedAt: "today",
      syncStatus: "local",
    }),
    ...overrides,
  };
  return {
    bridge,
    session: createMediaDetailSession({ media: mangaMedia, access: { kind: "guest" }, bridge }),
  };
}

describe("media loading performance and lifecycle", () => {
  it("reflects library edits and removal in an open detail without reloading providers", async () => {
    const { session, bridge } = makeSession();
    await session.load();
    const edited = {
      id: 12,
      media: mangaMedia,
      status: "PAUSED" as const,
      progress: 7,
      score: 8.5,
      progressVolumes: 0,
      repeat: 0,
      updatedAt: 1,
      notes: "Read later",
    };
    session.updateAccess({ ...member, libraryEntries: new Map([[mangaMedia.id, edited]]) });
    expect(session.getSnapshot().detail?.listEntry).toMatchObject({
      progress: 7,
      score: 8.5,
      status: "PAUSED",
    });
    session.updateAccess({ ...member, libraryEntries: new Map() });
    expect(session.getSnapshot().detail?.listEntry).toBeUndefined();
    expect(bridge.getAniListMediaDetail).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("starts chapters alongside metadata and opens without waiting for optional scores", async () => {
    const metadata = deferred<AniListMediaDetail>();
    const manga = deferred<MangaTitleSnapshot>();
    const score = deferred<undefined>();
    const { session, bridge } = makeSession({
      getAniListMediaDetail: vi.fn(() => metadata.promise),
      getMangaTitleSnapshot: vi.fn(() => manga.promise),
      getMalScore: vi.fn(() => score.promise),
    });
    const load = session.load();
    expect(bridge.getMangaTitleSnapshot).toHaveBeenCalledTimes(1);
    const opening = session.openReader();
    manga.resolve(mangaSnapshot);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().readerSession).toEqual(mangaSnapshot.reader);
    metadata.resolve({ ...detail, ...mangaMedia, malId: 42 });
    expect((await opening)?.id).toBe("chapter-2");
    expect(bridge.getAniListMediaDetail).toHaveBeenCalledTimes(1);
    expect(bridge.getMangaTitleSnapshot).toHaveBeenCalledTimes(1);
    score.resolve(undefined);
    await load;
    session.dispose();
  });

  it("keeps chapters usable when metadata fails", async () => {
    const { session } = makeSession({
      getAniListMediaDetail: async () => {
        throw new Error("Metadata timeout");
      },
    });
    await session.load();
    expect(session.getSnapshot().loading).toBe(false);
    expect(session.getSnapshot().readerSession).toEqual(mangaSnapshot.reader);
    expect(session.getSnapshot().error).toMatch(/title details are taking longer.*moment/i);
    expect((await session.openReader())?.id).toBe("chapter-1");
    session.dispose();
  });

  it("reactivates after development cleanup and ignores the abandoned result", async () => {
    const oldManga = deferred<MangaTitleSnapshot>();
    const { session, bridge } = makeSession({
      getMangaTitleSnapshot: vi
        .fn()
        .mockReturnValueOnce(oldManga.promise)
        .mockResolvedValue(mangaSnapshot),
    });
    const oldLoad = session.load();
    session.dispose();
    session.activate();
    await session.load();
    oldManga.resolve({ aniListId: mangaMedia.id, issues: [] });
    await oldLoad;
    expect(session.getSnapshot().readerSession).toEqual(mangaSnapshot.reader);
    expect(session.getSnapshot().loading).toBe(false);
    expect(bridge.cancelRequest).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("reduces simulated chapter readiness from 3000ms to 1200ms", async () => {
    vi.useFakeTimers();
    try {
      function later<T>(value: T, delay: number): Promise<T> {
        return new Promise<T>((resolve) => setTimeout(() => resolve(value), delay));
      }
      const { session } = makeSession({
        getAniListMediaDetail: () => later({ ...detail, ...mangaMedia, malId: 42 }, 800),
        getMangaTitleSnapshot: () => later(mangaSnapshot, 1200),
        getMalScore: () => later(undefined, 2200),
      });
      const load = session.load();
      await vi.advanceTimersByTimeAsync(1200);
      expect(session.getSnapshot().readerSession).toEqual(mangaSnapshot.reader);
      expect((await session.openReader())?.id).toBe("chapter-2");
      await vi.runAllTimersAsync();
      await load;
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ["timeout", /chapters are taking longer.*moment/i],
    ["429 cooldown", /MangaDex is busy.*few minutes/i],
    ["malformed response", /MangaDex returned incomplete data.*shortly/i],
  ])(
    "keeps metadata usable after a reader %s and supports an explicit retry",
    async (message, expected) => {
      const { session, bridge } = makeSession({
        getMangaTitleSnapshot: vi
          .fn()
          .mockRejectedValueOnce(new Error(message))
          .mockResolvedValue(mangaSnapshot),
      });
      await session.load();
      expect(session.getSnapshot().detail?.id).toBe(mangaMedia.id);
      expect(session.getSnapshot().error).toMatch(expected);
      expect(bridge.getMangaTitleSnapshot).toHaveBeenCalledTimes(1);
      await session.retryReader();
      expect((await session.openReader())?.id).toBe("chapter-2");
      expect(bridge.getMangaTitleSnapshot).toHaveBeenCalledTimes(2);
      expect(bridge.getAniListMediaDetail).toHaveBeenCalledTimes(1);
      session.dispose();
    },
  );

  it("allows an empty chapter result without inventing a chapter", async () => {
    const { session } = makeSession({
      getMangaTitleSnapshot: async () => ({
        ...mangaSnapshot,
        reader: { ...mangaSnapshot.reader!, chapters: [] },
      }),
    });
    await session.load();
    expect(await session.openReader()).toBeUndefined();
    expect(session.getSnapshot().loadingReader).toBe(false);
    expect(session.getSnapshot().error).toBe(
      "No readable chapters are available in English yet. Try another language if one is listed.",
    );
    session.dispose();
  });

  it("explains when MangaDex has no exact title mapping", async () => {
    const { session } = makeSession({
      getMangaTitleSnapshot: async () => ({
        aniListId: mangaMedia.id,
        issues: [],
        reader: {
          status: "unmapped",
          aniListId: mangaMedia.id,
          translatedLanguage: "en",
          availableLanguages: [],
          availableGroups: [],
          archiveStatus: "complete",
          chapters: [],
          message: "No exact links.al mapping",
        },
      }),
    });
    await session.load();
    expect(await session.openReader()).toBeUndefined();
    expect(session.getSnapshot().error).toBe(
      "This title is not linked to MangaDex yet, so AniStream cannot open its chapters.",
    );
    session.dispose();
  });

  it("keeps a language change when the old chapter request finishes later", async () => {
    const original = deferred<MangaTitleSnapshot>();
    const metadata = deferred<AniListMediaDetail>();
    const { session } = makeSession({
      getAniListMediaDetail: () => metadata.promise,
      getMangaTitleSnapshot: vi
        .fn()
        .mockReturnValueOnce(original.promise)
        .mockResolvedValue({
          ...mangaSnapshot,
          reader: { ...mangaSnapshot.reader, translatedLanguage: "es" },
        }),
    });
    const loading = session.load();
    await session.setMangaReaderPreferences({ aniListId: mangaMedia.id, translatedLanguage: "es" });
    original.resolve(mangaSnapshot);
    metadata.resolve({ ...detail, ...mangaMedia });
    await loading;
    expect(session.getSnapshot().readerSession?.translatedLanguage).toBe("es");
    expect(session.getSnapshot().detail?.id).toBe(mangaMedia.id);
    expect(session.getSnapshot().loading).toBe(false);
    session.dispose();
  });

  it("does not reopen a disposed title after a pending resume lookup", async () => {
    const resume = deferred<undefined>();
    const { session } = makeSession({ getMangaReadingResume: () => resume.promise });
    await session.load();
    const opening = session.openReader();
    await Promise.resolve();
    await Promise.resolve();
    session.dispose();
    resume.resolve(undefined);
    expect(await opening).toBeUndefined();
  });
});

describe("MediaDetailSession", () => {
  it("journals guest completion and exposes pending sync without a tracker mutation", async () => {
    const recorded: number[] = [];
    const session = createMediaDetailSession({
      media,
      access: { kind: "guest" },
      bridge: {
        getAniListMediaDetail: async () => detail,
        getMalScore: async () => undefined,
        getMangaTitleSnapshot: async () => ({ aniListId: 101, issues: [] }),
        cancelRequest: async () => undefined,
        getMangaReadingResume: async () => undefined,
        saveMangaReaderPreferences: async (input) => ({ ...input, updatedAt: "today" }),
        recordActivity: async (input) => {
          recorded.push(input.unit);
          return {
            ...input,
            completedProgress: input.unit,
            updatedAt: "today",
            syncStatus: "local",
          };
        },
      },
    });
    await session.load();
    await session.markEpisodeWatched(3);
    expect(recorded).toEqual([3]);
    expect(session.getSnapshot().error).toBeUndefined();
    session.dispose();
  });
  it("loads detail data and delegates tracker updates through viewer access", async () => {
    const session = createMediaDetailSession({
      media,
      access: member,
      bridge: {
        getAniListMediaDetail: vi.fn(async () => detail),
        getMalScore: vi.fn(async () => undefined),
        getMangaTitleSnapshot: vi.fn(async () => ({}) as MangaTitleSnapshot),
        cancelRequest: vi.fn(async () => undefined),
        saveMangaReaderPreferences: async (input) => ({ ...input, updatedAt: "today" }),
      },
    });

    await session.load();
    expect(session.getSnapshot().detail).toEqual(detail);

    await session.markMediaCompleted();
    expect(member.updateEntry).toHaveBeenCalledWith({
      id: 1,
      status: "COMPLETED",
      progress: 1,
    });
    session.dispose();
  });

  it("persists a reader preference and reloads chapters in the selected language", async () => {
    let translatedLanguage = "en";
    const session = createMediaDetailSession({
      media: mangaMedia,
      access: { kind: "guest" },
      bridge: {
        getAniListMediaDetail: async () => ({ ...detail, ...mangaMedia }),
        getMalScore: async () => undefined,
        getMangaTitleSnapshot: async () => ({
          aniListId: mangaMedia.id,
          reader: {
            status: "available",
            aniListId: mangaMedia.id,
            mangaDexId: "manga-id",
            translatedLanguage,
            availableLanguages: ["en", "es"],
            availableGroups: [],
            archiveStatus: "complete",
            chapters: [],
          },
          issues: [],
        }),
        saveMangaReaderPreferences: async (input) => {
          translatedLanguage = input.translatedLanguage;
          return { ...input, updatedAt: "2026-09-05T00:00:00Z" };
        },
        cancelRequest: async () => undefined,
        getMangaReadingResume: async () => undefined,
        recordActivity: async (input) => ({
          ...input,
          completedProgress: input.unit,
          updatedAt: "2026-09-05T00:00:00Z",
          syncStatus: "local",
        }),
      },
    });

    await session.load();
    await session.setMangaReaderPreferences({
      aniListId: mangaMedia.id,
      translatedLanguage: "es",
    });

    expect(session.getSnapshot().readerSession?.translatedLanguage).toBe("es");
    expect(session.getSnapshot().mangaPreferences?.translatedLanguage).toBe("es");
    session.dispose();
  });
});
