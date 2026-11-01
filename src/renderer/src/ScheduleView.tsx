import { Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AiringSchedule, AniListCatalogMedia } from "../../shared/contracts";
import type { PersonalRelease } from "../../shared/personal-library";
import { formatClockTime, formatCountdown } from "./airing";
import { CoverImage } from "./CoverImage";
import { usePersonalLibrary } from "./PersonalLibraryProvider";
import { friendlyRemoteError } from "./remote-error";
import {
  groupScheduleEntries,
  scheduleDays,
  scheduleListIds,
  scheduleMonth,
  scheduleWeek,
  weekLabel,
  weekOffsetOf,
  type ScheduleDay,
  type ScheduleGroup,
} from "./schedule-week";
import type { ViewerAccess } from "./viewer-access";

/** Week and Month follow the user's list; All airing is a week of everything on AniList. */
type ScheduleView = "week" | "month" | "all";

const VIEW_KEY = "anistream.schedule.view";
/** Titles shown in a month cell before "+N more" (which opens that week). */
const MONTH_CELL_LIMIT = 3;
/** Countdowns appear only this close to airing; further out, the time alone is clearer. */
const COUNTDOWN_WINDOW_MS = 24 * 60 * 60_000;

// The last answer per span/scope stays on screen when a refresh fails (e.g. offline).
const lastSchedules = new Map<string, AiringSchedule>();
const MAX_REMEMBERED_SCHEDULES = 8;

function rememberedView(): ScheduleView {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return saved === "month" || saved === "all" ? saved : "week";
  } catch {
    return "week";
  }
}

export function ScheduleView({
  access,
  onOpenMedia,
  onContinue,
}: {
  access: ViewerAccess;
  onOpenMedia: (media: AniListCatalogMedia) => void;
  onContinue: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const member = access.kind === "member";
  const { state: personal } = usePersonalLibrary();
  const [viewChoice, setViewChoice] = useState<ScheduleView>(rememberedView);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  // Continue Watching titles (local and AniList) lead the personal schedule; AniList Watching and
  // Planning entries follow. The key keeps the ID list stable across unrelated snapshot rebuilds.
  const continueKey = personal.continueAnime.map((title) => title.id).join(",");
  const listIds = useMemo(
    () =>
      scheduleListIds(
        access.kind === "member" ? access.libraryEntries.values() : [],
        continueKey ? continueKey.split(",").map(Number) : [],
      ),
    [access, continueKey],
  );
  // Without a library or watch history there is nothing personal to show: everything airing.
  const personalSchedule = member || personal.continueAnime.length > 0;
  const view: ScheduleView = personalSchedule ? viewChoice : "all";
  const monthly = view === "month";
  const setOffset = monthly ? setMonthOffset : setWeekOffset;
  const offset = monthly ? monthOffset : weekOffset;
  // Recomputed only when the span or the day changes, so the fetch key stays stable.
  const today = new Date(now);
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const week = useMemo(() => scheduleWeek(weekOffset, dayStart), [weekOffset, dayStart]);
  const month = useMemo(() => scheduleMonth(monthOffset, dayStart), [monthOffset, dayStart]);
  const span = monthly ? month : week;
  const unit = monthly ? "month" : "week";
  const listOnly = view !== "all";
  const requestKey = `${view}:${span.start}:${listOnly ? listIds.join(",") : ""}`;
  const [result, setResult] = useState<{ key: string; schedule?: AiringSchedule; error?: string }>(
    () => ({ key: requestKey, schedule: lastSchedules.get(requestKey) }),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    window.anistream
      .getAiringSchedule({
        start: span.start,
        end: span.end,
        ...(listOnly ? { mediaIds: listIds } : {}),
      })
      .then((schedule) => {
        if (!active) return;
        lastSchedules.delete(requestKey);
        lastSchedules.set(requestKey, schedule);
        while (lastSchedules.size > MAX_REMEMBERED_SCHEDULES)
          lastSchedules.delete(lastSchedules.keys().next().value!);
        setResult({ key: requestKey, schedule });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setResult({
          key: requestKey,
          schedule: lastSchedules.get(requestKey),
          error: friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "airing times",
            retained: lastSchedules.has(requestKey),
            fallback: "The schedule could not be loaded. Try again.",
          }),
        });
      });
    return () => {
      active = false;
    };
    // `requestKey` covers the view, span, and list IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, attempt]);

  // Failed (e.g. offline): try again by itself once the connection returns.
  const failedNow = result.key === requestKey && Boolean(result.error);
  useEffect(() => {
    if (!failedNow) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A moment after "online": the connection can be reported before it carries traffic.
    const retry = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => setAttempt((value) => value + 1), 1_000);
    };
    window.addEventListener("online", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [failedNow]);

  // A new span or view shows its last remembered answer until the fresh one arrives.
  const current =
    result.key === requestKey
      ? result
      : { key: requestKey, schedule: lastSchedules.get(requestKey), error: undefined };
  const schedule = current.schedule;
  const loading = !schedule && !current.error;
  const days = scheduleDays(span, schedule?.entries ?? [], now);
  const catchUp = personal.releases;
  const progressById = useMemo(() => {
    const progress = new Map<number, number>();
    if (access.kind === "member")
      for (const [id, entry] of access.libraryEntries) progress.set(id, entry.progress);
    for (const title of personal.continueAnime)
      progress.set(title.id, Math.max(progress.get(title.id) ?? 0, title.progress));
    return progress;
  }, [access, personal.continueAnime]);

  const chooseView = (next: ScheduleView): void => {
    setViewChoice(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A per-viewer convenience only; the page works without storage.
    }
  };
  const openWeekOf = (date: Date): void => {
    setWeekOffset(weekOffsetOf(date, dayStart));
    chooseView("week");
  };

  const heading = monthly
    ? month.month.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : weekOffset === 0
      ? "This week"
      : weekOffset === 1
        ? "Next week"
        : weekOffset === -1
          ? "Last week"
          : weekLabel(week, now);
  const subtitle = [
    monthly ? undefined : weekOffset >= -1 && weekOffset <= 1 ? weekLabel(week, now) : undefined,
    listOnly ? (member ? "From your list" : "From what you're watching") : "Everything airing",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="schedule-page page-rise" aria-labelledby="schedule-heading">
      <header className="page-head">
        <div className="page-head-title">
          <h1 id="schedule-heading">{heading}</h1>
          <p className="page-head-sub">{subtitle}</p>
        </div>
        <div className="page-head-actions">
          {personalSchedule ? (
            <div className="segmented" role="group" aria-label="Schedule view">
              {(
                [
                  ["week", "Week"],
                  ["month", "Month"],
                  ["all", "All airing"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => chooseView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="segmented" role="group" aria-label={`Change ${unit}`}>
            <button
              type="button"
              className="is-icon"
              aria-label={`Previous ${unit}`}
              title={`Previous ${unit}`}
              onClick={() => setOffset((value) => value - 1)}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" disabled={offset === 0} onClick={() => setOffset(0)}>
              Today
            </button>
            <button
              type="button"
              className="is-icon"
              aria-label={`Next ${unit}`}
              title={`Next ${unit}`}
              onClick={() => setOffset((value) => value + 1)}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {current.error ? (
        <div className="provider-note provider-note--action schedule-note" role="alert">
          <span>{current.error}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}
      {schedule?.partial ? (
        <p className="schedule-note schedule-note--quiet" role="status">
          {monthly
            ? "Your list has more airings this month than one view loads. Open a week to see them all."
            : "A busy week: showing the first airings AniList returned."}
        </p>
      ) : null}
      {listOnly && !listIds.length ? (
        <p className="schedule-note schedule-note--quiet">
          Nothing in Continue Watching or on your list yet. Choose All airing to browse.
        </p>
      ) : null}

      {/* Failed with nothing remembered: no grid of empty days that would read "nothing airs". */}
      {current.error && !schedule ? null : monthly ? (
        <MonthGrid
          days={days}
          month={month.month}
          loading={loading}
          now={now}
          progressById={progressById}
          onOpen={onOpenMedia}
          onOpenWeek={openWeekOf}
        />
      ) : (
        <WeekDays
          days={days}
          loading={loading}
          now={now}
          progressById={progressById}
          showListMark={!listOnly}
          onOpen={onOpenMedia}
        />
      )}

      {catchUp.length ? (
        <section className="schedule-catchup" aria-labelledby="schedule-catchup-heading">
          <h2 id="schedule-catchup-heading">
            Ready for you <span>{catchUp.length} new</span>
          </h2>
          <div className="schedule-catchup-row">
            {catchUp.map((release) => (
              <CatchUpCard key={release.key} release={release} onOpen={onContinue} />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

/** The week as day tabs (with their episode counts) above the chosen day's list. */
function WeekDays({
  days,
  loading,
  now,
  progressById,
  showListMark,
  onOpen,
}: {
  days: ScheduleDay[];
  loading: boolean;
  now: number;
  progressById: ReadonlyMap<number, number>;
  showListMark: boolean;
  onOpen: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const keys = days.map((day) => day.date.toDateString());
  const fallback =
    days.find((day) => day.isToday) ?? days.find((day) => day.entries.length) ?? days[0];
  // A day chosen in another week falls back to today (or the first day with airings).
  const [chosen, setChosen] = useState<string>();
  const selected = days.find((day) => day.date.toDateString() === chosen) ?? fallback;
  const selectedIndex = selected ? days.indexOf(selected) : 0;
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const groups = selected ? groupScheduleEntries(selected.entries) : [];
  const dayName = selected?.date.toLocaleDateString(undefined, { weekday: "long" });

  // Arrow keys, Home and End move between the days (the tab pattern).
  const moveFocus = (event: React.KeyboardEvent, index: number): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : index + step;
    if (next === index || next < 0 || next >= days.length) return;
    event.preventDefault();
    setChosen(keys[next]);
    tabs.current[next]?.focus();
  };

  return (
    <div className="schedule-week">
      <div className="schedule-days" role="tablist" aria-label="Days">
        {days.map((day, index) => {
          const count = day.entries.length;
          return (
            <button
              key={keys[index]}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`schedule-day-${index}`}
              aria-selected={index === selectedIndex}
              aria-controls="schedule-day-panel"
              tabIndex={index === selectedIndex ? 0 : -1}
              className={`schedule-day${day.isToday ? " is-today" : ""}`}
              onClick={() => setChosen(keys[index])}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <strong>
                {day.isToday
                  ? "Today"
                  : day.date.toLocaleDateString(undefined, { weekday: "short" })}
              </strong>
              <span>
                {day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {loading
                  ? null
                  : ` · ${count ? `${count} episode${count === 1 ? "" : "s"}` : "none"}`}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="schedule-day-panel"
        id="schedule-day-panel"
        role="tabpanel"
        aria-labelledby={`schedule-day-${selectedIndex}`}
        aria-busy={loading}
      >
        {loading ? (
          <ul className="ledger" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <li key={row} className="schedule-row-skeleton" />
            ))}
          </ul>
        ) : groups.length ? (
          <ul className="ledger">
            {groups.map((group) => (
              <li key={`${group.media.id}:${group.airingAt}`}>
                <ScheduleRow
                  group={group}
                  now={now}
                  progress={progressById.get(group.media.id)}
                  showListMark={showListMark}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="schedule-empty">Nothing airs on {dayName}</p>
        )}
      </div>
    </div>
  );
}

function episodeLabel(group: ScheduleGroup): string {
  return group.firstEpisode === group.lastEpisode
    ? `Ep ${group.firstEpisode}`
    : `Ep ${group.firstEpisode}–${group.lastEpisode}`;
}

/** "Episode 7 of 11", "Episodes 7–8", or "Episode 1180" when the total is unknown. */
function episodeLine(group: ScheduleGroup): string {
  if (group.firstEpisode !== group.lastEpisode)
    return `Episodes ${group.firstEpisode}–${group.lastEpisode}`;
  const total = group.media.totalProgress;
  return `Episode ${group.firstEpisode}${total ? ` of ${total}` : ""}`;
}

function ScheduleRow({
  group,
  now,
  progress,
  showListMark,
  onOpen,
}: {
  group: ScheduleGroup;
  now: number;
  progress?: number;
  showListMark: boolean;
  onOpen: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const airsInMs = group.airingAt * 1000 - now;
  const aired = airsInMs <= 0;
  const onList = progress !== undefined;
  const watched = onList && progress >= group.lastEpisode;
  const when = aired
    ? "Aired"
    : airsInMs <= COUNTDOWN_WINDOW_MS
      ? formatCountdown(group.airingAt, now).replace(/^in /, "In ")
      : undefined;
  // "Out now" is the one live state, so it alone carries the sky dot.
  const status = watched
    ? "Watched"
    : aired && onList
      ? "Out now"
      : showListMark && onList
        ? "On your list"
        : undefined;
  const time = formatClockTime(group.airingAt);
  const genres = (group.media.genres ?? []).slice(0, 2).join(", ");
  return (
    <button
      type="button"
      className={`schedule-row${aired ? " is-aired" : ""}`}
      onClick={() => onOpen(group.media)}
      aria-label={`${group.media.title}, ${episodeLine(group)}, ${time}${
        status ? `, ${status}` : when ? `, ${when}` : ""
      }`}
    >
      <span className="schedule-row-time">
        <time>{time}</time>
        {when ? <small>{when}</small> : null}
      </span>
      <CoverImage
        src={group.media.coverUrl}
        title={group.media.title}
        className="schedule-row-cover"
      />
      <span className="schedule-row-title">
        <strong>{group.media.title}</strong>
        {genres ? <small>{genres}</small> : null}
      </span>
      <span className="schedule-row-episode">{episodeLine(group)}</span>
      <span className={`schedule-row-status${status === "Out now" ? " is-new" : ""}`}>
        {status === "Out now" ? <span className="live-dot" aria-hidden="true" /> : null}
        {status === "Watched" ? <Check size={16} aria-hidden="true" /> : null}
        {status}
      </span>
    </button>
  );
}

function MonthGrid({
  days,
  month,
  loading,
  now,
  progressById,
  onOpen,
  onOpenWeek,
}: {
  days: ScheduleDay[];
  month: Date;
  loading: boolean;
  now: number;
  progressById: ReadonlyMap<number, number>;
  onOpen: (media: AniListCatalogMedia) => void;
  onOpenWeek: (date: Date) => void;
}): React.JSX.Element {
  return (
    <div className="schedule-month" aria-busy={loading}>
      <div className="schedule-month-weekdays" aria-hidden="true">
        {days.slice(0, 7).map((day) => (
          <span key={day.date.getDay()}>
            {day.date.toLocaleDateString(undefined, { weekday: "short" })}
          </span>
        ))}
      </div>
      <div className="schedule-month-grid">
        {days.map((day) => {
          const inMonth = day.date.getMonth() === month.getMonth();
          const groups = groupScheduleEntries(day.entries);
          const hidden = groups.length - MONTH_CELL_LIMIT;
          return (
            <section
              key={day.date.toISOString()}
              className={`schedule-month-cell${inMonth ? "" : " is-outside"}${day.isToday ? " is-today" : ""}`}
              aria-label={day.date.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            >
              <span className="schedule-month-date">{day.date.getDate()}</span>
              {loading && inMonth ? <span className="schedule-month-skeleton" /> : null}
              {groups.slice(0, MONTH_CELL_LIMIT).map((group) => {
                const aired = group.airingAt * 1000 <= now;
                const progress = progressById.get(group.media.id);
                const watched = progress !== undefined && progress >= group.lastEpisode;
                const time = formatClockTime(group.airingAt);
                return (
                  <button
                    type="button"
                    key={`${group.media.id}:${group.airingAt}`}
                    className={`schedule-month-entry${aired ? " is-aired" : ""}${watched ? " is-watched" : ""}`}
                    onClick={() => onOpen(group.media)}
                    aria-label={`${group.media.title}, ${episodeLabel(group).replace("Ep", "episode")}, ${time}${watched ? ", watched" : aired ? ", aired" : ""}`}
                  >
                    <CoverImage
                      src={group.media.coverUrl}
                      title={group.media.title}
                      className="schedule-month-cover"
                    />
                    <span className="schedule-month-copy">
                      <strong>{group.media.title}</strong>
                      <span>
                        {episodeLabel(group)} · {time}
                      </span>
                    </span>
                    {watched ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
                  </button>
                );
              })}
              {hidden > 0 ? (
                <button
                  type="button"
                  className="schedule-month-more"
                  onClick={() => onOpenWeek(day.date)}
                >
                  +{hidden} more
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CatchUpCard({
  release,
  onOpen,
}: {
  release: PersonalRelease;
  onOpen: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const label =
    release.kind === "aired"
      ? `Episode ${release.unit} is out`
      : `Chapter ${release.unit}${release.language ? ` · ${release.language.toUpperCase()}` : ""}`;
  return (
    <button type="button" className="schedule-catchup-card" onClick={() => onOpen(release.media)}>
      <CoverImage
        src={release.media.coverUrl}
        title={release.media.title}
        className="schedule-catchup-cover"
      />
      <span className="schedule-catchup-copy">
        <strong>{release.media.title}</strong>
        <span>
          {release.media.type === "ANIME" ? "Anime" : "Manga"} · {label}
        </span>
      </span>
    </button>
  );
}
