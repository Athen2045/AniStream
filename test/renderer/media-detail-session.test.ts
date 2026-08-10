import { describe, expect, it, vi } from "vitest";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  MangaTitleSnapshot,
} from "../../src/shared/contracts";
import { createMediaDetailSession } from "../../src/renderer/src/media-detail-session";
import type { ViewerAccess } from "../../src/renderer/src/viewer-access";

const media: AniListCatalogMedia = {
  id: 101,
  type: "ANIME",
  title: "Test title",
  coverUrl: "https://example.test/cover.jpg",
  genres: [],
  siteUrl: "https://anilist.co/anime/101",
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

describe("MediaDetailSession", () => {
  it("loads detail data and delegates tracker updates through viewer access", async () => {
    const session = createMediaDetailSession({
      media,
      access: member,
      bridge: {
        getAniListMediaDetail: vi.fn(async () => detail),
        getMalScore: vi.fn(async () => undefined),
        getMangaTitleSnapshot: vi.fn(async () => ({}) as MangaTitleSnapshot),
        cancelRequest: vi.fn(async () => undefined),
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
});
