import { describe, expect, it, vi } from "vitest";
import {
  MangaUpdatesClient,
  parseMangaUpdatesGroups,
  parseMangaUpdatesSeries,
} from "../../src/main/mangaupdates";

describe("MangaUpdates exact-ID enrichment", () => {
  it("normalizes a series record without accepting a mismatched ID", () => {
    const result = parseMangaUpdatesSeries(
      {
        series_id: 13,
        title: "One Piece",
        url: "https://www.mangaupdates.com/series/13/one-piece",
        type: "Manga",
        latest_chapter: 1189,
        licensed: true,
        completed: false,
      },
      13,
    );
    expect(result.status).toBe("available");
    expect(result.latestChapter).toBe(1189);
    expect(result.url).toContain("mangaupdates.com");

    expect(parseMangaUpdatesSeries({ series_id: 14 }, 13).status).toBe("unavailable");
  });

  it("normalizes and bounds scanlation group records", () => {
    const groups = parseMangaUpdatesGroups({
      group_list: [
        { group_id: 1, name: "Group A", url: "https://mangaupdates.com/group/1" },
        { group_id: 0, name: "Invalid" },
        { group_id: 2, name: "Group B", url: "http://unsafe.example" },
      ],
    });
    expect(groups).toEqual([
      { id: 1, name: "Group A", url: "https://mangaupdates.com/group/1" },
      { id: 2, name: "Group B", url: undefined },
    ]);
  });

  it("caches exact series reads and requests the documented public paths", async () => {
    const fetcher = vi.fn((input: URL) => {
      if (input.pathname.endsWith("/groups")) {
        return Promise.resolve(Response.json({ group_list: [] }));
      }
      return Promise.resolve(
        Response.json({ series_id: 13, title: "One Piece", latest_chapter: 1189 }),
      );
    });
    const client = new MangaUpdatesClient(fetcher as typeof fetch);

    await client.getSeries(13);
    await client.getSeries(13);
    await client.getGroups(13);
    await client.getGroups(13);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/v1/series/13");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("/v1/series/13/groups");
  });
});
