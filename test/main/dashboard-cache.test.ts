import { describe, expect, it } from "vitest";
import type { AniListDashboard, AniListEntry } from "../../src/shared/contracts";
import { serializeDashboardForCache } from "../../src/main/dashboard-cache";

function entry(id: number, status: AniListEntry["status"], updatedAt: number): AniListEntry {
  return {
    id,
    status,
    score: 0,
    progress: 1,
    repeat: 0,
    updatedAt,
    notes: "x".repeat(200),
    media: {
      id,
      type: "ANIME",
      title: `Title ${id}`,
      coverUrl: "https://s4.anilist.co/cover.jpg",
      siteUrl: `https://anilist.co/anime/${id}`,
    },
  };
}

function dashboard(entries: AniListEntry[]): AniListDashboard {
  return {
    profile: { id: 1 } as AniListDashboard["profile"],
    animeLists: [
      {
        name: "Watching",
        isCustomList: false,
        entries: entries.filter((e) => e.status === "CURRENT"),
      },
      {
        name: "Completed",
        isCustomList: false,
        entries: entries.filter((e) => e.status === "COMPLETED"),
      },
    ],
    mangaLists: [],
    fetchedAt: new Date(0).toISOString(),
  };
}

describe("offline AniList library copy", () => {
  it("stores a library that fits unchanged", () => {
    const small = dashboard([entry(1, "CURRENT", 1)]);
    expect(serializeDashboardForCache(small)).toBe(JSON.stringify(small));
  });

  it("trims an oversized library to in-progress and newest titles instead of failing", () => {
    const big = dashboard([
      entry(1, "CURRENT", 1),
      ...Array.from({ length: 200 }, (_, index) => entry(100 + index, "COMPLETED", index)),
    ]);
    const serialized = serializeDashboardForCache(big, 20_000);
    expect(serialized).toBeDefined();
    expect(serialized!.length).toBeLessThanOrEqual(20_000);
    const kept = JSON.parse(serialized!) as AniListDashboard;
    const ids = kept.animeLists.flatMap((group) => group.entries.map((item) => item.id));
    expect(ids).toContain(1);
    expect(ids).toContain(299); // newest completed survives, oldest is dropped
    expect(ids).not.toContain(100);
  });

  it("gives up only when even in-progress titles cannot fit", () => {
    const watching = dashboard(
      Array.from({ length: 50 }, (_, index) => entry(index, "CURRENT", index)),
    );
    expect(serializeDashboardForCache(watching, 2_000)).toBeUndefined();
  });
});
