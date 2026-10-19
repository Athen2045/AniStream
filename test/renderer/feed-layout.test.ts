import { describe, expect, it } from "vitest";
import { dailyRandom } from "../../src/main/recommendations/engine";
import { arrangeFeed, type FeedRowLike } from "../../src/renderer/src/feed-layout";

type Row = FeedRowLike & { id: string };

const order = (rows: Row[]) =>
  arrangeFeed(rows).map((entry) => (entry.kind === "slot" ? `[${entry.slot}]` : entry.row.id));

describe("For You page order", () => {
  it("places rows by kind with the page's rails between them, whatever order they arrive in", () => {
    const rows: Row[] = [
      { id: "try", tryNew: true },
      { id: "seed1" },
      { id: "pair", pair: ["Romance", "Comedy"] },
      { id: "theme", theme: "Time Travel" },
      { id: "seed2" },
      { id: "next", continuation: true },
      { id: "seed3" },
      { id: "seed4" },
    ];
    expect(order(rows)).toEqual([
      "[afterMain]",
      "next",
      "[afterContinuation]",
      "seed1",
      "theme",
      "[middle]",
      "seed2",
      "pair",
      "seed3",
      "seed4",
      "try",
      "[end]",
    ]);
  });

  it("keeps every slot when rows are missing, so the page's own rails always show", () => {
    expect(order([])).toEqual(["[afterMain]", "[afterContinuation]", "[middle]", "[end]"]);
    expect(order([{ id: "seed1" }])).toEqual([
      "[afterMain]",
      "[afterContinuation]",
      "seed1",
      "[middle]",
      "[end]",
    ]);
  });
});

describe("daily rotation", () => {
  it("is the same all day and changes the next day", () => {
    const day = Date.UTC(2026, 9, 19, 8);
    const draw = (now: number) => Array.from({ length: 4 }, dailyRandom("seeds:1:ANIME", now));
    const sameDay = (now: number) => {
      const random = dailyRandom("seeds:1:ANIME", now);
      return [random(), random(), random(), random()];
    };
    expect(sameDay(day)).toEqual(sameDay(day + 6 * 3_600_000));
    expect(sameDay(day)).not.toEqual(sameDay(day + 86_400_000));
    expect(draw(day).every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
