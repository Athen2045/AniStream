import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  createDownloadExtras,
  keptStillSources,
  playlistSeconds,
  skipTimesCopyKey,
} from "../../src/main/downloads/download-extras";
import { createTitleCopies } from "../../src/main/title-copies";
import { cachedEpisodeArtUrl } from "../../src/shared/artwork";
import type { AnimeDownload } from "../../src/shared/downloads";

const still = (episode: number) => `https://artworks.thetvdb.com/banners/episode/${episode}.jpg`;
const PLAYLIST = "#EXTM3U\n#EXTINF:600.4,\ns1.ts\n#EXTINF:840.2,\ns2.ts\n#EXT-X-ENDLIST\n";

function download(episode: number, status: AnimeDownload["status"] = "done"): AnimeDownload {
  return {
    id: `d${episode}`,
    aniListId: 7,
    episode,
    title: "Fixture",
    quality: "720p",
    status,
    bytesDone: 1,
    bytesExpected: 1,
    segmentsDone: 1,
    segmentsTotal: 1,
    audio: [],
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
  } as AnimeDownload;
}

function setup(items: AnimeDownload[], { malId = 52_991 }: { malId?: number } = {}) {
  const copies = createTitleCopies(new Database(":memory:"), () => [7]);
  copies.write(
    "art:7:28:0",
    7,
    [1, 2, 3].map((number) => ({ number, stillUrl: cachedEpisodeArtUrl(still(number)) })),
  );
  if (malId) copies.write("detail:ANIME:7", 7, { id: 7, malId });
  const stills = { get: vi.fn(async () => ({ body: Buffer.from([1]) })) };
  const skipTimes = {
    getSkipTimes: vi.fn(async () => [{ kind: "opening" as const, start: 90, end: 180 }]),
  };
  const extras = createDownloadExtras({
    downloads: () => items,
    copies,
    stills,
    skipTimes,
    readPlaylist: async () => PLAYLIST,
  });
  return { copies, stills, skipTimes, extras };
}

describe("download extras (what a downloaded episode needs offline)", () => {
  it("saves each downloaded episode's still, and only those", async () => {
    const { stills, extras } = setup([download(2), download(3, "queued")]);
    extras.save();
    await vi.waitFor(() => expect(stills.get).toHaveBeenCalledTimes(2));
    expect(stills.get).toHaveBeenCalledWith(still(2));
    expect(stills.get).toHaveBeenCalledWith(still(3));
    extras.save();
    expect(stills.get).toHaveBeenCalledTimes(2);
  });

  it("saves the skip times of a finished download under its own length", async () => {
    const { copies, skipTimes, extras } = setup([download(2), download(3, "downloading")]);
    extras.save();
    await vi.waitFor(() => expect(skipTimes.getSkipTimes).toHaveBeenCalledTimes(1));
    expect(skipTimes.getSkipTimes).toHaveBeenCalledWith(
      expect.objectContaining({
        aniListId: 7,
        malId: 52_991,
        episode: 2,
        durationSeconds: expect.closeTo(1_440.6, 3),
      }),
    );
    await vi.waitFor(() =>
      expect(copies.read(skipTimesCopyKey(7, 2, 1_441))).toEqual([
        { kind: "opening", start: 90, end: 180 },
      ]),
    );
  });

  it("tries again later when skip times could not be fetched (offline)", async () => {
    const { skipTimes, extras } = setup([download(2)]);
    skipTimes.getSkipTimes.mockRejectedValueOnce(new TypeError("fetch failed"));
    extras.save();
    await vi.waitFor(() => expect(skipTimes.getSkipTimes).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    extras.save();
    await vi.waitFor(() => expect(skipTimes.getSkipTimes).toHaveBeenCalledTimes(2));
  });

  it("asks nothing without the title's MAL id", async () => {
    const { skipTimes, stills, extras } = setup([download(2)], { malId: 0 });
    extras.save();
    await vi.waitFor(() => expect(stills.get).toHaveBeenCalled());
    expect(skipTimes.getSkipTimes).not.toHaveBeenCalled();
  });

  it("reads a playlist's length and lists the stills to keep", () => {
    expect(playlistSeconds(PLAYLIST)).toBeCloseTo(1_440.6);
    const { copies } = setup([]);
    expect(keptStillSources(copies)).toEqual([still(1), still(2), still(3)]);
  });
});
