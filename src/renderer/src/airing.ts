import type { AniListAiringTime, AniListCatalogMedia } from "../../shared/contracts";

/** Catalog media plus the optional detail fields that sharpen airing answers. */
export type AiringMedia = Pick<AniListCatalogMedia, "type" | "status" | "nextAiringEpisode"> & {
  upcomingEpisodes?: AniListAiringTime[];
  startDate?: string;
};

/** An episode that has not aired yet; `airingAt` (Unix seconds) only when AniList knows it. */
export interface UnairedEpisode {
  airingAt?: number;
}

/**
 * Whether an episode is still to air. Exact AniList airing rows win; otherwise anything at or
 * past the next scheduled episode, or any episode of a title not yet released, is unaired.
 */
export function unairedEpisode(
  media: AiringMedia,
  episode: number,
  now = Date.now(),
): UnairedEpisode | undefined {
  const next = media.nextAiringEpisode;
  const known =
    media.upcomingEpisodes?.find((row) => row.episode === episode) ??
    (next?.episode === episode ? next : undefined);
  if (known) return known.airingAt * 1000 > now ? { airingAt: known.airingAt } : undefined;
  if (media.status === "NOT_YET_RELEASED") return {};
  if (next && episode > next.episode) return {};
  return undefined;
}

export interface AiringOutlookRow extends AniListAiringTime {
  /** The last episode AniList lists for the title. */
  final: boolean;
}

export interface AiringOutlook {
  rows: AiringOutlookRow[];
  /** "Weekly on Tuesday at 6:30 PM" when every listed airing keeps a weekly slot. */
  cadence?: string;
}

const WEEK_SECONDS = 7 * 86_400;
/** Daylight-saving changes move a weekly slot by an hour. */
const SLOT_TOLERANCE_SECONDS = 3_600;
const OUTLOOK_LIMIT = 13;

/**
 * The upcoming airings AniList knows for a title (detail rows plus the catalog's next episode),
 * soonest first. Undefined when nothing is scheduled.
 */
export function airingOutlook(
  media: AiringMedia & { totalProgress?: number },
  now = Date.now(),
  locale?: string,
): AiringOutlook | undefined {
  if (media.type !== "ANIME") return undefined;
  const byEpisode = new Map<number, AniListAiringTime>();
  for (const row of [
    ...(media.upcomingEpisodes ?? []),
    ...(media.nextAiringEpisode ? [media.nextAiringEpisode] : []),
  ]) {
    if (row.airingAt * 1000 > now && !byEpisode.has(row.episode)) byEpisode.set(row.episode, row);
  }
  const rows = [...byEpisode.values()]
    .sort((a, b) => a.airingAt - b.airingAt)
    .slice(0, OUTLOOK_LIMIT)
    .map((row) => ({ ...row, final: row.episode === media.totalProgress }));
  if (!rows.length) return undefined;
  const weekly =
    rows.length >= 3 &&
    rows.every((row, index) => {
      if (index === 0) return true;
      const gap = row.airingAt - rows[index - 1]!.airingAt;
      return Math.abs(gap - WEEK_SECONDS) <= SLOT_TOLERANCE_SECONDS;
    });
  if (!weekly) return { rows };
  const first = new Date(rows[0]!.airingAt * 1000);
  const weekday = first.toLocaleDateString(locale, { weekday: "long" });
  return { rows, cadence: `Weekly on ${weekday} at ${formatClockTime(rows[0]!.airingAt, locale)}` };
}

/** "Airs Tue, Oct 14, 6:30 PM" when the time is known, otherwise "Not aired yet". */
export function episodeAiringLabel(unaired: UnairedEpisode, now = Date.now()): string {
  return unaired.airingAt ? `Airs ${formatAiringTime(unaired.airingAt, now)}` : "Not aired yet";
}

/**
 * The title-level block for media AniList lists as not yet released: the first episode's exact
 * airing time when known, else the (possibly partial) start date. Undefined once released.
 */
export function titleReleaseNotice(media: AiringMedia, now = Date.now()): string | undefined {
  if (media.status !== "NOT_YET_RELEASED") return undefined;
  const verb = media.type === "ANIME" ? "Airs" : "Releases";
  const first = media.type === "ANIME" ? unairedEpisode(media, 1, now) : undefined;
  if (first?.airingAt) return `${verb} on ${formatAiringTime(first.airingAt, now)}`;
  const start = media.startDate ? formatFuzzyStart(media.startDate) : undefined;
  if (start) return `${verb} ${start}`;
  return media.type === "ANIME" ? "Air date not announced yet" : "Release date not announced yet";
}

/** Local weekday, date, and time; the year appears only when it differs from now. */
export function formatAiringTime(airingAt: number, now = Date.now(), locale?: string): string {
  const date = new Date(airingAt * 1000);
  return date.toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local clock time only, e.g. "6:30 PM". */
export function formatClockTime(airingAt: number, locale?: string): string {
  return new Date(airingAt * 1000).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "in 2h 14m", "in 3d 4h", or "in 5m" for a future time; "now" once it has passed. */
export function formatCountdown(airingAt: number, now = Date.now()): string {
  const minutes = Math.ceil((airingAt * 1000 - now) / 60_000);
  if (minutes <= 0) return "now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `in ${days}d${hours ? ` ${hours}h` : ""}`;
  if (hours) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `in ${minutes}m`;
}

/** AniList fuzzy dates are "YYYY", "YYYY-MM", or "YYYY-MM-DD". */
function formatFuzzyStart(value: string, locale?: string): string | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year) return undefined;
  if (!month) return `in ${year}`;
  const date = new Date(year, month - 1, day || 1);
  return day
    ? `on ${date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`
    : `in ${date.toLocaleDateString(locale, { month: "long", year: "numeric" })}`;
}
