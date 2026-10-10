import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bookmark, Film, KeyRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  MoreCatalogItem,
  MoreCatalogPage,
  MoreLibrary,
  MoreMediaType,
  MoreTitleStatusAction,
  SimklRow,
} from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { MoreHero } from "./MoreHero";
import { MoreContinueCard, MorePosterCard, type MoreCardActions } from "./MorePosterCard";
import { MoreTitlePage } from "./MoreTitlePage";
import { Pagination } from "./Pagination";
import { friendlyRemoteError } from "./remote-error";
import { moreKey, moreSnapshot, type MorePlayTarget } from "./more-format";
import { motionEase } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { useMoreForYou } from "./useMoreForYou";
import { useAppPreferences } from "./app-preferences";
import { continueKey, isRemovedFromContinue, useContinueRemovals } from "./continue-dismissals";
import type { MoreRecommendation } from "../../shared/discovery";
import { startBrowsing } from "./play-timer";
import { HERO_SLIDES, mixHeroPicks, withTrendingSlide } from "./hero-picks";
import { usePersonalHero } from "./usePersonalHero";
import { hasHiddenGenre, useHiddenTags } from "./hidden-tags";
import { LegalFooter } from "./LegalFooter";

/** Home rails, or the full grid behind one rail's "View all". */
type MoreFilter = "ALL" | "MOVIE" | "TV" | "LIST";
const WATCH_LIST = "My Watch List";
const HERO_SIZE = 6;
const EMPTY_LIBRARY: MoreLibrary = { watchlist: [], continueWatching: [] };

function isTmdbConfigurationError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /TMDB is not configured|ANISTREAM_TMDB_ACCESS_TOKEN/i.test(message);
}

export interface MoreSelection {
  item: MoreCatalogItem;
  action: "details" | "play";
  /** An exact episode to start (from Up Next); otherwise the page's resume target. */
  start?: MorePlayTarget;
  /** Changes when Up Next starts the same title again, so the page remounts and plays. */
  nonce?: number;
  /** Where Back goes, named on the button ("More" unless the title was opened from Search). */
  backLabel?: string;
}

/** Trending rails for the whole app session; More remounts each time it is opened. */
const appTrending: { movies?: MoreCatalogPage; shows?: MoreCatalogPage } = {};

export function MoreView({
  selection,
  viewer,
  onSelect,
  onPrimary,
  onCloseTitle,
}: {
  selection?: MoreSelection;
  /** The signed-in AniList account ID, or "guest"; More For You belongs to this viewer. */
  viewer: string;
  onSelect: (item: MoreCatalogItem) => void;
  onPrimary: (item: MoreCatalogItem) => void;
  onCloseTitle: () => void;
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const [filter, setFilter] = useState<MoreFilter>("ALL");
  const [moviePage, setMoviePage] = useState<MoreCatalogPage | undefined>(appTrending.movies);
  const [tvPage, setTvPage] = useState<MoreCatalogPage | undefined>(appTrending.shows);
  const [gridPage, setGridPage] = useState(1);
  const [grid, setGrid] = useState<{ key: string; page?: MoreCatalogPage; error?: string }>();
  const [library, setLibrary] = useState<MoreLibrary>(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(!appTrending.movies || !appTrending.shows);
  const [error, setError] = useState<string>();
  const [configurationMissing, setConfigurationMissing] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const homeScroll = useRef(0);
  // Time to play starts when More opens.
  useEffect(() => startBrowsing("MORE"), []);

  useEffect(() => {
    // Returning to More shows the rails it already has; Retry (refreshAttempt) still reloads.
    if (refreshAttempt === 0 && appTrending.movies && appTrending.shows) return;
    let active = true;
    void Promise.all([
      window.anistream.getMoreTrending("MOVIE", 1),
      window.anistream.getMoreTrending("TV", 1),
    ])
      .then(([movies, shows]) => {
        appTrending.movies = movies;
        appTrending.shows = shows;
        if (!active) return;
        setMoviePage(movies);
        setTvPage(shows);
        setError(undefined);
        setConfigurationMissing(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setConfigurationMissing(isTmdbConfigurationError(reason));
        setError(
          friendlyRemoteError(reason, {
            provider: "TMDB",
            operation: "More catalog",
            fallback: "Movies and shows are unavailable right now. Configure TMDB, then try again.",
          }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshAttempt]);

  const loadLibrary = useCallback(() => {
    void window.anistream
      .getMoreLibrary()
      .then(setLibrary)
      .catch(() => undefined);
  }, []);
  useEffect(loadLibrary, [loadLibrary]);

  // Movies/Shows filters page through the full trending list; page 1 reuses the home rails.
  const gridType: MoreMediaType | undefined =
    filter === "MOVIE" || filter === "TV" ? filter : undefined;
  useEffect(() => {
    if (!gridType || gridPage === 1) return;
    let active = true;
    const key = `${gridType}:${gridPage}`;
    void window.anistream
      .getMoreTrending(gridType, gridPage)
      .then((page) => {
        if (active) setGrid({ key, page });
      })
      .catch((reason: unknown) => {
        if (active)
          setGrid({
            key,
            error: friendlyRemoteError(reason, {
              provider: "TMDB",
              operation: "More catalog",
              fallback: "This page could not be loaded.",
            }),
          });
      });
    return () => {
      active = false;
    };
  }, [gridPage, gridType]);

  // Leave the home scrolled where it was when a title page opens and closes.
  const selectionKey = selection ? moreKey(selection.item) : undefined;
  const previousSelection = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectionKey;
    if (selectionKey && !previous) {
      homeScroll.current = window.scrollY;
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (selectionKey && previous && selectionKey !== previous) {
      window.scrollTo({ top: 0, behavior: "instant" });
    } else if (!selectionKey && previous) {
      window.scrollTo({ top: homeScroll.current, behavior: "instant" });
    }
  }, [selectionKey]);

  const savedKeys = useMemo(() => new Set(library.watchlist.map(moreKey)), [library.watchlist]);
  const completedKeys = useMemo(
    () => new Set((library.completed ?? []).map((ref) => `${ref.type}:${ref.tmdbId}`)),
    [library.completed],
  );
  const [statusNote, setStatusNote] = useState<string>();
  const setStatus = useCallback(
    (item: MoreCatalogItem, action: MoreTitleStatusAction) => {
      const key = moreKey(item);
      setStatusNote(undefined);
      setLibrary((current) => ({
        ...current,
        watchlist:
          action === "planning"
            ? [item, ...current.watchlist.filter((entry) => moreKey(entry) !== key)]
            : current.watchlist.filter((entry) => moreKey(entry) !== key),
        completed:
          action === "completed"
            ? [...(current.completed ?? []), { type: item.type, tmdbId: item.id }]
            : current.completed,
      }));
      void window.anistream
        .setMoreTitleStatus(moreSnapshot(item), action)
        .then((result) => {
          if (result.simkl === "failed") setStatusNote(result.message);
        })
        .catch(() => setStatusNote(`${item.title} could not be saved. Try again.`))
        .finally(loadLibrary);
    },
    [loadLibrary],
  );
  const actions: MoreCardActions = useMemo(
    () => ({
      onSelect,
      onPrimary,
      isSaved: (item) => savedKeys.has(moreKey(item)),
      isCompleted: (item) => completedKeys.has(moreKey(item)),
      onSetStatus: setStatus,
    }),
    [completedKeys, onPrimary, onSelect, savedKeys, setStatus],
  );
  const [simklRows, setSimklRows] = useState<SimklRow[]>([]);
  useEffect(() => {
    let active = true;
    const load = (): void => {
      void window.anistream
        .getSimklRows()
        .then((rows) => active && setSimklRows(rows))
        .catch(() => undefined);
    };
    load();
    // Connecting or disconnecting Simkl changes which list rows are readable.
    let connected: boolean | undefined;
    const off = window.anistream.onSimklStatusChanged((status) => {
      const now = status.auth.status === "connected";
      if (connected !== undefined && now !== connected) load();
      connected = now;
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  const preferences = useAppPreferences();
  const hiddenTags = useHiddenTags();
  // Trending mixes TMDB and Simkl, alternating, and never shows the same title twice.
  const trendingMovies = useMemo(
    () =>
      mixTrending(
        "Movies",
        (moviePage?.items ?? []).filter((item) => !hasHiddenGenre(item.genres, hiddenTags)),
        simklRows,
        "MOVIE",
      ),
    [hiddenTags, moviePage, simklRows],
  );
  const trendingShows = useMemo(
    () =>
      mixTrending(
        "Shows",
        (tvPage?.items ?? []).filter((item) => !hasHiddenGenre(item.genres, hiddenTags)),
        simklRows,
        "TV",
      ),
    [hiddenTags, tvPage, simklRows],
  );
  const removals = useContinueRemovals();
  const forYou = useMoreForYou(preferences.forYou, viewer);
  // From three movies/shows watched, the hero mixes For You with "Because you watched" picks.
  const personalHero = usePersonalHero<MoreCatalogItem>({
    section: "MORE",
    owner: "local",
    enabled: preferences.forYou,
    feedKey: forYou.feed?.requestId,
    sectionTitles: forYou.feed?.sectionTitles,
    build: async () => {
      const feed = forYou.feed;
      if (!feed) return [];
      const wide = (entries: MoreRecommendation[]): MoreCatalogItem[] =>
        entries.map((entry) => entry.item).filter((item) => item.backdropUrl);
      return mixHeroPicks(
        { reason: "For You", items: wide(feed.items) },
        (feed.rows ?? [])
          .filter((row) => !row.theme)
          .map((row) => ({
            reason: `Because you watched ${row.seedTitle}`,
            items: wide(row.items),
          })),
        moreKey,
        HERO_SLIDES,
      );
    },
    watchedSince: (item, savedAt) => {
      const key = moreKey(item);
      if (completedKeys.has(key)) return true;
      const entry = library.continueWatching.find((row) => moreKey(row.item) === key);
      return Boolean(entry && (Date.parse(entry.updatedAt) || 0) > savedAt);
    },
  });

  const heroItems = useMemo(() => {
    const visible = (item: MoreCatalogItem): boolean =>
      Boolean(item.backdropUrl) && !hasHiddenGenre(item.genres, hiddenTags);
    const movies = (moviePage?.items ?? []).filter(visible);
    const shows = (tvPage?.items ?? []).filter(visible);
    if (filter === "MOVIE") return movies.slice(0, HERO_SIZE);
    if (filter === "TV") return shows.slice(0, HERO_SIZE);
    const mixed: MoreCatalogItem[] = [];
    for (let index = 0; mixed.length < HERO_SIZE && index < HERO_SIZE; index += 1) {
      if (movies[index]) mixed.push(movies[index]);
      if (shows[index] && mixed.length < HERO_SIZE) mixed.push(shows[index]);
    }
    if (!personalHero) return mixed;
    // A personalized set keeps one live Trending slide (not cached, so it stays current).
    const watched = new Set([
      ...completedKeys,
      ...library.continueWatching.map((entry) => moreKey(entry.item)),
    ]);
    return withTrendingSlide(
      personalHero.map((slide) => slide.item),
      mixed,
      moreKey,
      (item) => watched.has(moreKey(item)),
    ).items;
  }, [
    completedKeys,
    filter,
    hiddenTags,
    library.continueWatching,
    moviePage,
    personalHero,
    tvPage,
  ]);

  if (selection) {
    return (
      <MoreTitlePage
        key={`${selectionKey}:${selection.action}:${selection.nonce ?? 0}`}
        item={selection.item}
        initialAction={selection.action}
        initialTarget={selection.start}
        saved={savedKeys.has(moreKey(selection.item))}
        completed={completedKeys.has(moreKey(selection.item))}
        onSetStatus={setStatus}
        onBack={onCloseTitle}
        backLabel={selection.backLabel}
        onProgressChanged={loadLibrary}
        onOpenTitle={(next) => {
          window.scrollTo({ top: 0, behavior: "instant" });
          onSelect(next);
        }}
      />
    );
  }

  const continueWatching = library.continueWatching.filter(
    (entry) =>
      (!gridType || entry.item.type === gridType) &&
      !isRemovedFromContinue(
        removals.removed,
        continueKey("MORE", moreKey(entry.item)),
        Date.parse(entry.updatedAt) || 0,
      ),
  );
  const currentGrid = grid?.key === `${gridType}:${gridPage}` ? grid : undefined;
  const gridError = gridPage > 1 ? currentGrid?.error : undefined;
  const gridSource =
    gridType && gridPage > 1 ? currentGrid?.page : gridType === "MOVIE" ? moviePage : tvPage;
  const showHero = filter === "ALL" && heroItems.length > 0;
  const gridTitle =
    filter === "LIST" ? WATCH_LIST : filter === "MOVIE" ? "Trending Movies" : "Trending Shows";
  return (
    <section className={`more-page${showHero ? "" : " more-page--plain"}`}>
      {showHero ? (
        <MoreHero items={heroItems} actions={actions} reducedMotion={reducedMotion} />
      ) : loading && filter === "ALL" ? (
        <div className="more-hero more-hero--skeleton" aria-hidden="true" />
      ) : (
        <div className="more-plain-top">
          {filter !== "ALL" ? (
            <button className="more-back" type="button" onClick={() => chooseFilter("ALL")}>
              <ArrowLeft size={17} aria-hidden="true" />
              More
            </button>
          ) : null}
        </div>
      )}

      <div className="more-content">
        {error ? <p className="error-banner">{error}</p> : null}
        {statusNote ? (
          <p className="more-search-status" role="status">
            {statusNote}
          </p>
        ) : null}
        {configurationMissing ? (
          <section className="more-empty-state" aria-live="polite">
            <KeyRound size={28} aria-hidden="true" />
            <p className="catalog-kicker">TMDB setup required</p>
            <h2>Connect the More catalog</h2>
            <p>
              Add <code>ANISTREAM_TMDB_ACCESS_TOKEN</code> to the main-process <code>.env</code>{" "}
              file, then restart AniStream to load movies and shows.
            </p>
            <button type="button" onClick={() => retry()}>
              Retry catalog
            </button>
          </section>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={filter}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: motionEase } }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6, transition: { duration: 0.14 } }}
          >
            {filter === "LIST" ? (
              <section className="more-section" aria-label={WATCH_LIST}>
                <div className="more-section-head">
                  <h2>{WATCH_LIST}</h2>
                  <span className="more-count">
                    {library.watchlist.length} title{library.watchlist.length === 1 ? "" : "s"}
                  </span>
                </div>
                {library.watchlist.length ? (
                  <PosterGrid items={library.watchlist} actions={actions} />
                ) : (
                  <section className="more-empty-state">
                    <Bookmark size={28} aria-hidden="true" />
                    <h2>Your list is empty</h2>
                    <p>
                      Use + on any movie or show to keep it here. Your watch list stays on this
                      device.
                    </p>
                  </section>
                )}
              </section>
            ) : (
              <>
                {filter === "ALL" && continueWatching.length ? (
                  <section className="more-section more-rail" aria-label="Continue Watching">
                    <div className="more-section-head rail-heading">
                      <h2>Continue Watching</h2>
                    </div>
                    <ContentCarousel label="Continue Watching">
                      {continueWatching.map((entry) => (
                        <MoreContinueCard
                          key={moreKey(entry.item)}
                          entry={entry}
                          actions={actions}
                        />
                      ))}
                    </ContentCarousel>
                  </section>
                ) : null}
                {gridType ? (
                  <section
                    className="more-section"
                    aria-label={`Trending ${gridType === "MOVIE" ? "movies" : "shows"}`}
                  >
                    <div className="more-section-head">
                      <h2>{gridTitle}</h2>
                    </div>
                    {gridError ? <p className="error-banner">{gridError}</p> : null}
                    {gridSource ? (
                      <PosterGrid
                        items={gridSource.items}
                        actions={actions}
                        rankOffset={(gridPage - 1) * 20}
                      />
                    ) : (
                      <p className="more-search-status" role="status">
                        Loading…
                      </p>
                    )}
                    {gridSource ? (
                      <Pagination
                        label={`Trending ${gridType === "MOVIE" ? "movies" : "shows"} pages`}
                        page={gridPage}
                        totalPages={gridSource.pageInfo.totalPages}
                        hasNextPage={gridSource.pageInfo.hasNextPage}
                        onPageChange={(next) => {
                          setGridPage(next);
                          window.scrollTo({ top: 0, behavior: "instant" });
                        }}
                      />
                    ) : null}
                  </section>
                ) : (
                  <>
                    {preferences.forYou ? (
                      <MoreForYouRails state={forYou} actions={actions} />
                    ) : null}
                    {library.watchlist.length ? (
                      <PosterRail
                        title={WATCH_LIST}
                        items={library.watchlist}
                        actions={actions}
                        onViewAll={() => chooseFilter("LIST")}
                      />
                    ) : null}
                    {trendingMovies.items.length ? (
                      <PosterRail
                        title={trendingMovies.title}
                        items={trendingMovies.items}
                        actions={actions}
                        onViewAll={() => chooseFilter("MOVIE")}
                      />
                    ) : null}
                    {trendingShows.items.length ? (
                      <PosterRail
                        title={trendingShows.title}
                        items={trendingShows.items}
                        actions={actions}
                        onViewAll={() => chooseFilter("TV")}
                      />
                    ) : null}
                    {simklRows
                      .filter((row) => row.kind === "list")
                      .map((row) => (
                        <SimklRail key={row.id} row={row} actions={actions} />
                      ))}
                  </>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {!loading &&
        !configurationMissing &&
        !error &&
        !moviePage?.items.length &&
        !tvPage?.items.length ? (
          <section className="more-empty-state" aria-live="polite">
            <Film size={28} aria-hidden="true" />
            <h2>The More catalog is empty</h2>
            <p>Try loading the catalog again, or search for a different movie or show.</p>
            <button type="button" onClick={() => retry()}>
              Retry catalog
            </button>
          </section>
        ) : null}
        <LegalFooter>
          <p className="more-attribution">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </LegalFooter>
      </div>
    </section>
  );

  function chooseFilter(value: MoreFilter): void {
    setFilter(value);
    setGridPage(1);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function retry(): void {
    setMoviePage(undefined);
    setTvPage(undefined);
    setError(undefined);
    setConfigurationMissing(false);
    setLoading(true);
    setRefreshAttempt((attempt) => attempt + 1);
  }
}

/** For You plus "Because you watched X" rows; absent until the viewer has watched enough. */
function MoreForYouRails({
  state,
  actions,
}: {
  state: ReturnType<typeof useMoreForYou>;
  actions: MoreCardActions;
}): React.JSX.Element | null {
  const { feed } = state;
  const items = feed?.items ?? [];
  const rows = (feed?.rows ?? []).filter((row) => row.items.length);
  if (!feed && !state.error) return null;
  // Hidden until enough movies or shows were watched to learn from (user request 2026-10-09).
  if (feed?.status === "learning" && !state.error) return null;
  const poster = (entry: MoreRecommendation, inRow: boolean): React.JSX.Element => (
    <MorePosterCard
      key={moreKey(entry.item)}
      item={entry.item}
      actions={actions}
      caption={moreReason(entry, inRow)}
      onDismiss={() => state.dismiss(entry)}
    />
  );
  return (
    <>
      <section className="more-section more-rail" aria-label="For You">
        <div className="more-section-head rail-heading">
          <h2>For You</h2>
          <button
            className="more-link"
            type="button"
            disabled={state.loading}
            onClick={state.refresh}
          >
            {state.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {state.error ? <p className="error-banner">{state.error}</p> : null}
        {feed?.message ? <p className="more-search-status">{feed.message}</p> : null}
        {state.undo ? (
          <p className="more-search-status" role="status">
            {state.undo.item.title} hidden from For You.{" "}
            <button className="more-link" type="button" onClick={state.undoDismiss}>
              Undo
            </button>
          </p>
        ) : null}
        {items.length ? (
          <ContentCarousel label="For You">
            {items.map((entry) => poster(entry, false))}
          </ContentCarousel>
        ) : null}
      </section>
      {rows.map((row) => {
        const heading = row.continuation
          ? "Next in film series you watched"
          : row.theme
            ? `Because you like ${row.theme}`
            : `Because you watched ${row.seedTitle}`;
        return (
          <section
            key={
              row.continuation
                ? "next"
                : row.theme
                  ? `theme:${row.theme}`
                  : `${row.seedType}:${row.seedId}`
            }
            className="more-section more-rail"
            aria-label={heading}
          >
            <div className="more-section-head rail-heading">
              <h2>{heading}</h2>
            </div>
            <ContentCarousel label={heading}>
              {row.items.map((entry) => poster(entry, !row.theme))}
            </ContentCarousel>
          </section>
        );
      })}
    </>
  );
}

function moreReason(entry: MoreRecommendation, inRow: boolean): string {
  const reason = inRow
    ? entry.reasonCodes.find((code) => code !== "similar-to")
    : entry.reasonCodes[0];
  if (reason === "similar-to" && entry.relatedTitle)
    return `Because you watched ${entry.relatedTitle}`;
  if (reason === "same-creator") return "From people you like";
  if (reason === "matches-tag") return "Themes you enjoy";
  if (reason === "matches-genre") return "Genres you enjoy";
  if (reason === "highly-rated") return "Highly rated on TMDB";
  if (reason === "explore-more") return "Something different to explore";
  return "Recommended by TMDB viewers";
}

function PosterRail({
  title,
  items,
  actions,
  ranked = false,
  onViewAll,
}: {
  title: string;
  items: MoreCatalogItem[];
  actions: MoreCardActions;
  ranked?: boolean;
  onViewAll: () => void;
}): React.JSX.Element {
  return (
    <section className="more-section more-rail" aria-label={title}>
      <div className="more-section-head rail-heading">
        <h2>{title}</h2>
        <button className="more-link" type="button" onClick={onViewAll}>
          View all <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <ContentCarousel label={title}>
        {items.map((item, index) => (
          <MorePosterCard
            key={moreKey(item)}
            item={item}
            rank={ranked ? index + 1 : undefined}
            actions={actions}
          />
        ))}
      </ContentCarousel>
    </section>
  );
}

/** A Simkl Trending or Custom List row; the heading names Simkl, as its attribution rule asks. */
function SimklRail({
  row,
  actions,
}: {
  row: SimklRow;
  actions: MoreCardActions;
}): React.JSX.Element {
  const label = row.kind === "list" ? `${row.title} · Simkl list` : row.title;
  return (
    <section className="more-section more-rail" aria-label={label}>
      <div className="more-section-head rail-heading">
        <h2>{label}</h2>
      </div>
      <ContentCarousel label={label}>
        {row.items.map((item, index) => (
          <MorePosterCard
            key={moreKey(item)}
            item={item}
            rank={row.kind === "trending" ? index + 1 : undefined}
            actions={actions}
          />
        ))}
      </ContentCarousel>
    </section>
  );
}

/**
 * Interleaves TMDB's weekly trending with Simkl's most-watched for one type, skipping repeats.
 * The heading names Simkl whenever its data is shown, as Simkl's attribution rule requires.
 */
function mixTrending(
  label: "Movies" | "Shows",
  tmdb: MoreCatalogItem[],
  simklRows: SimklRow[],
  type: MoreMediaType,
): { title: string; items: MoreCatalogItem[] } {
  const simkl =
    simklRows.find((row) => row.kind === "trending" && row.items[0]?.type === type)?.items ?? [];
  const seen = new Set<string>();
  const items: MoreCatalogItem[] = [];
  for (let index = 0; index < Math.max(tmdb.length, simkl.length) && items.length < 30; index += 1)
    for (const item of [tmdb[index], simkl[index]])
      if (item && !seen.has(moreKey(item))) {
        seen.add(moreKey(item));
        items.push(item);
      }
  return {
    title: simkl.length ? `Trending ${label} on TMDB & Simkl` : `Trending ${label}`,
    items,
  };
}

function PosterGrid({
  items,
  actions,
  rankOffset,
}: {
  items: MoreCatalogItem[];
  actions: MoreCardActions;
  rankOffset?: number;
}): React.JSX.Element {
  return (
    <div className="more-grid">
      {items.map((item, index) => (
        <MorePosterCard
          key={moreKey(item)}
          item={item}
          rank={rankOffset !== undefined ? rankOffset + index + 1 : undefined}
          actions={actions}
        />
      ))}
    </div>
  );
}
