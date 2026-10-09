import { afterEach, describe, expect, it, vi } from "vitest";
import type { AniListEntry, AniListGroup } from "../../src/shared/contracts";
import {
  buildLibraryShelves,
  defaultShelfKey,
  filterLibrary,
  meanScore,
  readLibraryView,
  shelfFormats,
  writeLibraryView,
} from "../../src/renderer/src/profile-library";

function entry(
  id: number,
  status: AniListEntry["status"],
  format: string,
  extra: Partial<AniListEntry> = {},
): AniListEntry {
  return {
    id,
    status,
    score: 0,
    progress: 1,
    repeat: 0,
    updatedAt: id,
    media: {
      id: 1000 + id,
      type: "ANIME",
      title: `Title ${id}`,
      coverUrl: "",
      format,
      siteUrl: `https://anilist.co/anime/${1000 + id}`,
    },
    ...extra,
  };
}

const groups: AniListGroup[] = [
  {
    name: "Completed TV",
    isCustomList: false,
    entries: [entry(1, "COMPLETED", "TV", { score: 9 })],
  },
  {
    name: "Completed Movie",
    isCustomList: false,
    entries: [entry(2, "COMPLETED", "MOVIE", { score: 7 })],
  },
  { name: "Watching", isCustomList: false, entries: [entry(3, "CURRENT", "TV")] },
  { name: "Favourites", isCustomList: true, entries: [entry(1, "COMPLETED", "TV", { score: 9 })] },
];

afterEach(() => vi.unstubAllGlobals());

describe("Profile library shelves", () => {
  it("merges per-format status lists, orders by status, then adds custom lists", () => {
    const shelves = buildLibraryShelves(groups, true);
    expect(shelves.map((shelf) => [shelf.label, shelf.entries.length])).toEqual([
      ["Watching", 1],
      ["Completed", 2],
      ["Favourites", 1],
    ]);
    expect(defaultShelfKey(shelves)).toBe("status:CURRENT");
    expect(shelfFormats(shelves[1])).toEqual(["MOVIE", "TV"]);
  });

  it("filters by title and format, sorts, and averages each rated entry once", () => {
    const completed = buildLibraryShelves(groups, true)[1].entries;
    expect(
      filterLibrary(completed, { query: "", format: "MOVIE", sort: "UPDATED_DESC" }),
    ).toHaveLength(1);
    expect(
      filterLibrary(completed, { query: "", format: "", sort: "SCORE_DESC" }).map((e) => e.id),
    ).toEqual([1, 2]);
    expect(
      filterLibrary(completed, { query: "title 2", format: "", sort: "TITLE_ASC" }),
    ).toHaveLength(1);
    expect(meanScore(groups)).toEqual({ mean: 8, rated: 2 });
  });

  it("defaults to grid and remembers list view per library type", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    expect(readLibraryView("ANIME")).toBe("grid");
    writeLibraryView("MANGA", "list");
    expect(readLibraryView("MANGA")).toBe("list");
    expect(readLibraryView("ANIME")).toBe("grid");
  });
});
