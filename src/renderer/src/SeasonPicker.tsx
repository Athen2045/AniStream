import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, LoaderCircle, Search } from "lucide-react";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListMediaDetail,
  AnimeEpisodeRange,
  AnimeEpisodeRanges,
} from "../../shared/contracts";
import { motionTransition } from "./motion";
import { friendlyRemoteError } from "./remote-error";
import {
  buildAnimeSeries,
  createSeriesLoader,
  inferMediaDisplayedPartNumber,
  inferMediaDisplayedSeasonNumber,
  isSeasonEntry,
  seasonSubtitle,
  type AnimeSeasonChoice,
  type AnimeSeries,
} from "./anime-season-chain";

/** Long arc lists (One Piece) get a search field in the season menu. */
const ARC_SEARCH_MIN = 8;

/** One renderer-session loader for every season box: two-hop series graphs, cached. */
const loadSeriesDetail = createSeriesLoader((id) => window.anistream.getAnimeSeriesGraph(id));

export function SeasonPicker({
  media,
  onNavigate,
  onCurrentNumber,
  ranges,
  activeRange,
  onSelectRange,
  onArcModeChange,
}: {
  media: AniListCatalogMedia | AniListMediaDetail;
  onNavigate?: (media: AniListCatalogMedia) => void;
  onCurrentNumber: (number: number) => void;
  /** Arcs (or TheTVDB seasons) of a long runner; shown here only when it has no other seasons. */
  ranges?: AnimeEpisodeRanges;
  activeRange?: AnimeEpisodeRange;
  onSelectRange: (range: AnimeEpisodeRange) => void;
  onArcModeChange: (arcMode: boolean) => void;
}): React.JSX.Element | null {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reducedMotion = useAppReducedMotion();
  const inferredSeasonNumber = inferMediaDisplayedSeasonNumber(media);
  const inferredNumber = inferredSeasonNumber ?? 1;
  const currentChoice = useMemo<AnimeSeasonChoice>(
    () => ({
      number: inferredNumber,
      partNumber: inferMediaDisplayedPartNumber(media),
      media,
      episodeCount: media.totalProgress,
      current: true,
    }),
    [inferredNumber, media],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Episodes watched per title, from this device's history (no network): the menu's progress bars.
  const [watchedById, setWatchedById] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [attempt, setAttempt] = useState(0);
  // Keyed by title and attempt: a result for anything else is simply not shown.
  const loadKey = `${media.id}:${attempt}`;
  const [outcome, setOutcome] = useState<{ key: string; series?: AnimeSeries; error?: string }>();
  const settled = outcome?.key === loadKey ? outcome : undefined;
  const series = settled?.series;
  const error = settled?.error;
  const loading = !settled;
  const loaded = series !== undefined;
  const seasons = series?.seasons.length ? series.seasons : [currentChoice];
  const extras = series?.extras ?? [];
  const selected = seasons.find((choice) => choice.current) ?? currentChoice;
  const currentIsSeason = isSeasonEntry(media);
  // A long runner AniList lists without any other season (One Piece) is browsed by arc instead.
  const arcMode = Boolean(
    ranges && activeRange && loaded && currentIsSeason && series.seasons.length <= 1,
  );
  const hasExactPrequel =
    "relations" in media &&
    media.relations.some(
      (relation) => relation.relationType === "PREQUEL" && relation.media.type === "ANIME",
    );
  const awaitingSeasonNumber =
    inferredSeasonNumber === undefined &&
    (!("relations" in media) || hasExactPrequel) &&
    !loaded &&
    !arcMode;

  // The series loads with the title (one or two light requests, cached), not on first open.
  useEffect(() => {
    let active = true;
    const key = `${media.id}:${attempt}`;
    loadSeriesDetail(media.id)
      .then((detail) => buildAnimeSeries(detail, loadSeriesDetail))
      .then((result) => {
        if (!active) return;
        setOutcome({ key, series: result });
        onCurrentNumber(result.seasons.find((choice) => choice.current)?.number ?? inferredNumber);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setOutcome({
          key,
          error: friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "connected seasons",
            fallback: "Connected seasons could not be loaded. Try again shortly.",
          }),
        });
      });
    return () => {
      active = false;
    };
    // `onCurrentNumber` is a state setter from the parent; the walk reruns only per title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, attempt]);

  useEffect(() => onArcModeChange(arcMode), [arcMode, onArcModeChange]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    window.anistream
      .getLocalActivity()
      .then((activity) => {
        if (!active) return;
        const next = new Map<number, number>();
        for (const entry of activity)
          if (entry.media.type === "ANIME")
            next.set(
              entry.media.id,
              Math.max(next.get(entry.media.id) ?? 0, entry.completedProgress),
            );
        setWatchedById(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  const listProgress = "listEntry" in media ? (media.listEntry?.progress ?? 0) : 0;
  const watchedOf = (id: number, current: boolean): number =>
    Math.max(watchedById.get(id) ?? 0, current ? listProgress : 0);

  useEffect(() => {
    if (!open) return;
    fitMenuBelowTrigger(triggerRef.current, menuRef.current);
    // Long lists open on the current entry.
    menuRef.current
      ?.querySelector<HTMLElement>("[aria-checked='true']")
      ?.scrollIntoView({ block: "nearest" });
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  function openAndFocusFirst(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (!open) setQuery("");
    setOpen(true);
    window.requestAnimationFrame(() => {
      const options =
        pickerRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
      const current = pickerRef.current?.querySelector<HTMLButtonElement>(
        "[role='menuitemradio'][aria-checked='true']",
      );
      (current ?? options?.[0])?.focus();
    });
  }

  function moveOptionFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // Home and End move the caret inside the arc search field.
    if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End"))
      return;
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']"),
    ];
    if (!options.length) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex <= 0 ? options.length - 1 : currentIndex - 1)
            : currentIndex < 0 || currentIndex === options.length - 1
              ? 0
              : currentIndex + 1;
    options[nextIndex]?.focus();
  }

  function choose(action: () => void, current: boolean): void {
    setOpen(false);
    setQuery("");
    // An arc changes the list in place, so focus returns to the pill; a season opens its page.
    if (current || arcMode) triggerRef.current?.focus();
    if (!current) action();
  }

  const triggerTitle = arcMode
    ? (activeRange?.title ?? "")
    : !currentIsSeason
      ? mediaFormatLabel(media.format)
      : awaitingSeasonNumber
        ? error
          ? "Season unavailable"
          : "Finding season…"
        : seasonChoiceLabel(selected);
  const triggerDetail =
    arcMode && activeRange
      ? rangeEpisodesLabel(activeRange)
      : !currentIsSeason
        ? media.title
        : awaitingSeasonNumber && !error
          ? "Checking AniList"
          : episodeCountLabel(selected.episodeCount);

  // Nothing to pick: AniList lists no prequel, sequel, movie or special for this show, and it is not
  // a long runner browsed by arc (One Piece keeps the box for its arcs). Details that link no other
  // anime at all settle it before the series walk, so the box never flashes up first.
  const standalone =
    "relations" in media && !media.relations.some((relation) => relation.media.type === "ANIME");
  if (!arcMode && (loaded ? seasons.length <= 1 && extras.length === 0 : standalone && !ranges))
    return null;

  const badge = arcMode
    ? ranges && activeRange
      ? String(ranges.ranges.findIndex((range) => range.start === activeRange.start) + 1)
      : undefined
    : currentIsSeason && !awaitingSeasonNumber
      ? `S${selected.number}`
      : undefined;
  const arcQuery = query.trim().toLocaleLowerCase();
  const shownRanges =
    arcMode && ranges
      ? ranges.ranges.filter((range) => {
          if (!arcQuery) return true;
          const episode = Number(arcQuery);
          return Number.isInteger(episode) && episode > 0
            ? episode >= range.start && episode <= range.end
            : range.title.toLocaleLowerCase().includes(arcQuery);
        })
      : [];

  return (
    <div className="season-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`season-picker-trigger${badge ? "" : " season-picker-trigger--plain"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          // Each opening starts with the full list.
          if (!open) setQuery("");
          setOpen(!open);
        }}
        onKeyDown={openAndFocusFirst}
      >
        {badge ? (
          <span className="season-picker-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
        <span className="season-picker-trigger-copy">
          <strong>{triggerTitle}</strong>
          <small>{triggerDetail}</small>
        </span>
        <ChevronDown aria-hidden="true" size={16} className={open ? "is-open" : undefined} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            id={menuId}
            className={`season-picker-menu${arcMode ? " season-picker-menu--arcs" : ""}`}
            role="menu"
            aria-label={arcMode ? "Arcs" : "Series seasons"}
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={motionTransition(reducedMotion, "fast")}
            onKeyDown={moveOptionFocus}
          >
            {arcMode && ranges && activeRange ? (
              <>
                {ranges.ranges.length > ARC_SEARCH_MIN ? (
                  <label className="season-picker-search">
                    <Search aria-hidden="true" size={15} />
                    <input
                      type="search"
                      value={query}
                      placeholder="Find an arc or episode number…"
                      aria-label="Find an arc or episode number"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                ) : null}
                <div className="season-picker-menu-heading">
                  <span>Arcs</span>
                  <small>{ranges.kind === "arc" ? "From TMDB" : "From TheTVDB"}</small>
                </div>
                {shownRanges.map((range) => {
                  const current = range.start === activeRange.start;
                  return (
                    <button
                      key={range.start}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      className={`season-picker-arc${current ? " is-current" : ""}`}
                      onClick={() => choose(() => onSelectRange(range), current)}
                    >
                      <strong>
                        {range.title}
                        {range.filler ? <span className="season-picker-filler">Filler</span> : null}
                      </strong>
                      <small>{rangeShortLabel(range)}</small>
                      {current ? <Check aria-hidden="true" size={16} /> : <i aria-hidden="true" />}
                    </button>
                  );
                })}
                {!shownRanges.length ? (
                  <p className="season-picker-status" role="status">
                    No arc matches “{query.trim()}”.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="season-picker-menu-heading">
                  <span>Seasons</span>
                  <small>From AniList</small>
                </div>
                {seasons.map((choice) => {
                  const current = choice.current && currentIsSeason;
                  const total = choice.episodeCount ?? choice.media.totalProgress;
                  const progress = watchedOf(choice.media.id, current);
                  return (
                    <button
                      key={choice.media.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      className={current ? "is-current" : undefined}
                      onClick={() => choose(() => onNavigate?.(choice.media), current)}
                    >
                      <SeasonThumb media={choice.media} />
                      <span className="season-picker-option-copy">
                        <strong>{seasonChoiceLabel(choice)}</strong>
                        <small>
                          {[
                            choice.media.seasonYear,
                            choice.episodeCount ? `${choice.episodeCount} eps` : undefined,
                            seasonSubtitle(choice.media.title, seasons[0]?.media.title),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        {progress > 0 && total ? (
                          <span className="season-picker-progress" aria-hidden="true">
                            <i style={{ width: `${Math.min(100, (progress / total) * 100)}%` }} />
                          </span>
                        ) : null}
                      </span>
                      {current ? (
                        <span className="season-picker-tag">Watching</span>
                      ) : total && progress >= total ? (
                        <span className="season-picker-tag season-picker-tag--done">Watched</span>
                      ) : null}
                    </button>
                  );
                })}
              </>
            )}
            {extras.length ? (
              <>
                <div className="season-picker-menu-heading season-picker-menu-heading--group">
                  <span>Movies &amp; specials</span>
                </div>
                {extras.map((extra) => (
                  <button
                    key={extra.media.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={extra.current}
                    className={extra.current ? "is-current" : undefined}
                    onClick={() => choose(() => onNavigate?.(extra.media), extra.current)}
                  >
                    <SeasonThumb media={extra.media} />
                    <span className="season-picker-option-copy">
                      <strong>{extra.media.title}</strong>
                      <small>
                        {mediaFormatLabel(extra.media.format)}
                        {extra.media.seasonYear ? ` · ${extra.media.seasonYear}` : ""}
                      </small>
                    </span>
                    {extra.current ? <span className="season-picker-tag">Watching</span> : null}
                  </button>
                ))}
              </>
            ) : null}
            {loading ? (
              <p className="season-picker-status" role="status">
                <LoaderCircle aria-hidden="true" size={16} /> Loading connected seasons…
              </p>
            ) : null}
            {error ? (
              <div className="season-picker-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                  Retry
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const MENU_MAX_HEIGHT = 540;
const MENU_MIN_HEIGHT = 260;
/** Space kept clear above the trigger after scrolling: the window controls and Back sit there. */
const MENU_TOP_CLEARANCE = 72;
const MENU_BOTTOM_GAP = 34;

/**
 * Opens the season menu fully on screen: the page scrolls only as far as the menu needs (never
 * pushing the trigger under the window controls), and the menu is capped to the room left below.
 */
function fitMenuBelowTrigger(trigger: HTMLElement | null, menu: HTMLElement | null): void {
  if (!trigger || !menu) return;
  const wanted = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
  const box = trigger.getBoundingClientRect();
  const room = window.innerHeight - box.bottom - MENU_BOTTOM_GAP;
  if (room < wanted) {
    const shift = Math.max(0, Math.min(wanted - room, box.top - MENU_TOP_CLEARANCE));
    if (shift > 0) trigger.closest(".title-page")?.scrollBy({ top: shift });
  }
  const roomAfter = window.innerHeight - trigger.getBoundingClientRect().bottom - MENU_BOTTOM_GAP;
  menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, roomAfter))}px`;
}

/** A season's banner (else its cover) as a small 16:9 thumbnail. */
function SeasonThumb({ media }: { media: AniListCatalogMedia }): React.JSX.Element {
  const art = media.bannerUrl ?? media.coverUrl;
  return (
    <span className="season-picker-thumb" aria-hidden="true">
      {art ? <img src={art} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}

function rangeShortLabel(range: AnimeEpisodeRange): string {
  return range.start === range.end ? `Ep ${range.start}` : `Eps ${range.start}–${range.end}`;
}

function rangeEpisodesLabel(range: AnimeEpisodeRange): string {
  return range.start === range.end
    ? `Episode ${range.start}`
    : `Episodes ${range.start}–${range.end}`;
}

export function mediaFormatLabel(format: string | undefined): string {
  switch (format) {
    case "MOVIE":
      return "Movie";
    case "OVA":
      return "OVA";
    case "ONA":
      return "ONA";
    case "SPECIAL":
      return "Special";
    case "TV_SHORT":
      return "Short";
    case "MUSIC":
      return "Music video";
    default:
      return "TV";
  }
}

export function rangeContaining(
  ranges: readonly AnimeEpisodeRange[],
  episode: number,
): AnimeEpisodeRange | undefined {
  return (
    ranges.find((range) => episode >= range.start && episode <= range.end) ??
    (episode > (ranges.at(-1)?.end ?? 0) ? ranges.at(-1) : ranges[0])
  );
}

function episodeCountLabel(count: number | undefined): string {
  if (!count) return "Episodes TBA";
  return `${count} ${count === 1 ? "episode" : "episodes"}`;
}

function seasonChoiceLabel(choice: AnimeSeasonChoice): string {
  return `Season ${choice.number}${choice.partNumber ? ` · Part ${choice.partNumber}` : ""}`;
}
