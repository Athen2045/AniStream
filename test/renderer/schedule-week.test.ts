import { describe, expect, it } from "vitest";
import type { AiringScheduleEntry, AniListEntry } from "../../src/shared/contracts";
import {
  groupScheduleEntries,
  scheduleDays,
  scheduleListIds,
  scheduleMonth,
  scheduleWeek,
  weekLabel,
  weekOffsetOf,
} from "../../src/renderer/src/schedule-week";

// Wednesday 7 Oct 2026, 15:00 local time.
const NOW = new Date(2026, 9, 7, 15, 0, 0).getTime();

describe("schedule week", () => {
  it("spans local Monday 00:00 to Sunday 23:59:59 and moves by whole weeks", () => {
    const week = scheduleWeek(0, NOW);
    expect(week.days[0]).toEqual(new Date(2026, 9, 5));
    expect(week.days[6]).toEqual(new Date(2026, 9, 11));
    expect(week.start).toBe(new Date(2026, 9, 5).getTime() / 1000);
    expect(week.end).toBe(new Date(2026, 9, 12).getTime() / 1000 - 1);
    expect(scheduleWeek(1, NOW).days[0]).toEqual(new Date(2026, 9, 12));
    expect(scheduleWeek(-1, NOW).days[0]).toEqual(new Date(2026, 8, 28));
  });

  it("starts the week on Monday even when today is Sunday", () => {
    const sunday = new Date(2026, 9, 11, 23, 30).getTime();
    expect(scheduleWeek(0, sunday).days[0]).toEqual(new Date(2026, 9, 5));
  });

  it("groups entries by local day and marks today", () => {
    const week = scheduleWeek(0, NOW);
    const entry = (day: number, hour: number): AiringScheduleEntry => ({
      episode: 1,
      airingAt: new Date(2026, 9, day, hour).getTime() / 1000,
      media: { id: day * 100 + hour } as AiringScheduleEntry["media"],
    });
    const days = scheduleDays(week, [entry(5, 9), entry(7, 1), entry(7, 23), entry(11, 22)], NOW);
    expect(days.map((day) => day.entries.length)).toEqual([1, 0, 2, 0, 0, 0, 1]);
    expect(days.findIndex((day) => day.isToday)).toBe(2);
  });

  it("labels ranges inside and across months", () => {
    expect(weekLabel(scheduleWeek(0, NOW), NOW, "en-US")).toBe("Oct 5 – 11");
    expect(weekLabel(scheduleWeek(-1, NOW), NOW, "en-US")).toBe("Sep 28 – Oct 4");
  });

  it("uses only watching or planning anime as exact IDs", () => {
    const row = (id: number, type: "ANIME" | "MANGA", status: AniListEntry["status"]) =>
      ({ media: { id, type }, status }) as AniListEntry;
    expect(
      scheduleListIds([
        row(3, "ANIME", "CURRENT"),
        row(1, "ANIME", "PLANNING"),
        row(2, "ANIME", "COMPLETED"),
        row(4, "MANGA", "CURRENT"),
        row(5, "ANIME", "DROPPED"),
        row(6, "ANIME", "PAUSED"),
        row(3, "ANIME", "REPEATING"),
      ]),
    ).toEqual([1, 3, 6]);
  });

  it("builds a Monday-first month grid padded to whole weeks", () => {
    const october = scheduleMonth(0, NOW);
    expect(october.month).toEqual(new Date(2026, 9, 1));
    expect(october.days).toHaveLength(35);
    expect(october.days[0]).toEqual(new Date(2026, 8, 28));
    expect(october.days.at(-1)).toEqual(new Date(2026, 10, 1));
    expect(october.end).toBe(new Date(2026, 10, 2).getTime() / 1000 - 1);
    // March 2027 starts on a Monday and needs five rows; August 2027 needs six.
    expect(scheduleMonth(5, NOW).days[0]).toEqual(new Date(2027, 2, 1));
    expect(scheduleMonth(10, NOW).days).toHaveLength(42);
    expect(scheduleMonth(-1, NOW).month).toEqual(new Date(2026, 8, 1));
  });

  it("finds the week offset of a date for month-to-week jumps", () => {
    expect(weekOffsetOf(new Date(2026, 9, 7), NOW)).toBe(0);
    expect(weekOffsetOf(new Date(2026, 9, 20), NOW)).toBe(2);
    expect(weekOffsetOf(new Date(2026, 8, 28), NOW)).toBe(-1);
  });

  it("merges a batch release of one title into a single episode range", () => {
    const media = (id: number) => ({ id }) as AiringScheduleEntry["media"];
    const groups = groupScheduleEntries([
      { media: media(1), episode: 2, airingAt: 100 },
      { media: media(1), episode: 1, airingAt: 100 },
      { media: media(2), episode: 7, airingAt: 100 },
      { media: media(1), episode: 3, airingAt: 100 },
      { media: media(1), episode: 4, airingAt: 200 },
    ]);
    expect(groups.map((group) => [group.media.id, group.firstEpisode, group.lastEpisode])).toEqual([
      [1, 1, 3],
      [2, 7, 7],
      [1, 4, 4],
    ]);
  });

  it("puts Continue Watching titles first, merged with list IDs and bounded", () => {
    const row = (id: number) =>
      ({ media: { id, type: "ANIME" }, status: "CURRENT" }) as AniListEntry;
    expect(scheduleListIds([row(5), row(2)], [9, 2, 0, -1])).toEqual([2, 5, 9]);
    expect(scheduleListIds([], [7, 3])).toEqual([3, 7]);
    const many = Array.from({ length: 250 }, (_, index) => row(index + 1000));
    const ids = scheduleListIds(many, [1, 2]);
    expect(ids).toHaveLength(200);
    expect(ids.slice(0, 2)).toEqual([1, 2]);
  });
});
