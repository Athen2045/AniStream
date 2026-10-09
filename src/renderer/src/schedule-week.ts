import type { AiringScheduleEntry, AniListEntry } from "../../shared/contracts";

export interface ScheduleWeek {
  /** Unix seconds, inclusive: local Monday 00:00 to Sunday 23:59:59. */
  start: number;
  end: number;
  /** Local midnight of each day, Monday first. */
  days: Date[];
}

export interface ScheduleDay {
  date: Date;
  isToday: boolean;
  entries: AiringScheduleEntry[];
}

/** Statuses whose titles belong on "My list": what the user watches or plans to. */
const LIST_STATUSES = new Set(["CURRENT", "PLANNING", "REPEATING", "PAUSED"]);
const MAX_LIST_IDS = 200;

/** The local Monday-to-Sunday week `offset` weeks from the one holding `now`. */
export function scheduleWeek(offset: number, now = Date.now()): ScheduleWeek {
  const today = new Date(now);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  const days = Array.from(
    { length: 7 },
    (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index),
  );
  // Built from calendar dates (not +7×24h) so daylight-saving weeks keep their real length.
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return {
    start: Math.floor(monday.getTime() / 1000),
    end: Math.floor(nextMonday.getTime() / 1000) - 1,
    days,
  };
}

export interface ScheduleMonth extends ScheduleWeek {
  /** Local midnight on the 1st of the shown month. */
  month: Date;
}

/**
 * The Monday-first grid of whole weeks covering the month `offset` months from `now`
 * (35 or 42 days, padded with the neighbouring months' days like a wall calendar).
 */
export function scheduleMonth(offset: number, now = Date.now()): ScheduleMonth {
  const today = new Date(now);
  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const first = new Date(month);
  first.setDate(1 - ((month.getDay() + 6) % 7));
  const lastOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const trailing = 6 - ((lastOfMonth.getDay() + 6) % 7);
  const end = new Date(
    lastOfMonth.getFullYear(),
    lastOfMonth.getMonth(),
    lastOfMonth.getDate() + trailing + 1,
  );
  const days: Date[] = [];
  for (
    let day = new Date(first);
    day < end;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  )
    days.push(day);
  return {
    month,
    start: Math.floor(first.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000) - 1,
    days,
  };
}

/** How many weeks the week holding `date` is from the current week (for "+N more" jumps). */
export function weekOffsetOf(date: Date, now = Date.now()): number {
  const target = scheduleWeek(0, date.getTime()).days[0]!;
  const current = scheduleWeek(0, now).days[0]!;
  // Calendar-day difference, rounded so a daylight-saving hour cannot shift the result.
  return Math.round((target.getTime() - current.getTime()) / (7 * 86_400_000));
}

/** Splits a span's entries into its local days, keeping AniList's time order. */
export function scheduleDays(
  week: ScheduleWeek,
  entries: AiringScheduleEntry[],
  now = Date.now(),
): ScheduleDay[] {
  const today = new Date(now).toDateString();
  return week.days.map((date) => {
    const key = date.toDateString();
    return {
      date,
      isToday: key === today,
      entries: entries.filter((entry) => new Date(entry.airingAt * 1000).toDateString() === key),
    };
  });
}

/** One title's airing slot; a batch release (several episodes at once) is a single group. */
export interface ScheduleGroup {
  media: AiringScheduleEntry["media"];
  airingAt: number;
  firstEpisode: number;
  lastEpisode: number;
}

/** Merges entries of the same title airing at the same moment, keeping time order. */
export function groupScheduleEntries(entries: AiringScheduleEntry[]): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>();
  for (const entry of entries) {
    const key = `${entry.media.id}:${entry.airingAt}`;
    const group = groups.get(key);
    if (group) {
      group.firstEpisode = Math.min(group.firstEpisode, entry.episode);
      group.lastEpisode = Math.max(group.lastEpisode, entry.episode);
    } else
      groups.set(key, {
        media: entry.media,
        airingAt: entry.airingAt,
        firstEpisode: entry.episode,
        lastEpisode: entry.episode,
      });
  }
  return [...groups.values()];
}

/**
 * The user's schedule titles as exact AniList IDs (bounded): every anime behind Continue Watching
 * first, then AniList anime they are watching or planning. Sorted so the request key is stable.
 */
export function scheduleListIds(
  entries: Iterable<AniListEntry>,
  continueIds: Iterable<number> = [],
): number[] {
  const ids = new Set<number>();
  for (const id of continueIds) if (Number.isInteger(id) && id > 0) ids.add(id);
  for (const entry of entries)
    if (entry.media.type === "ANIME" && LIST_STATUSES.has(entry.status)) ids.add(entry.media.id);
  return [...ids].slice(0, MAX_LIST_IDS).sort((a, b) => a - b);
}

/** "Oct 6 – 12" or "Sep 29 – Oct 5", with the year when it is not the current one. */
export function weekLabel(week: ScheduleWeek, now = Date.now(), locale?: string): string {
  const first = week.days[0]!;
  const last = week.days[6]!;
  const showYear = last.getFullYear() !== new Date(now).getFullYear();
  const from = first.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const to = last.toLocaleDateString(locale, {
    ...(first.getMonth() === last.getMonth() ? {} : { month: "short" }),
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });
  return `${from} – ${to}`;
}
