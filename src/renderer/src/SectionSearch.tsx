import { Search, SlidersHorizontal, X } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListSearchPerson,
  MoreCatalogItem,
} from "../../shared/contracts";
import { moreFilterCount, type MoreBrowseFilters } from "../../shared/more-filters";
import { useAppPreferences } from "./app-preferences";
import {
  DEFAULT_SORT,
  activeFilterCount,
  emptyFilters,
  filterKey,
  type CatalogFilterState,
} from "./catalog-filters";
import { formatMediaLabel } from "./format-label";
import { DEFAULT_MORE_SORT, emptyMoreFilters } from "./more-filter-state";
import { formatScore, moreKey, moreSnapshot } from "./more-format";
import { addRecentSearch, useRecentSearches } from "./recent-searches";
import { friendlyRemoteError } from "./remote-error";
import { isConfidentMatch } from "./search-helpers";
import { SearchFiltersPanel } from "./SearchFiltersPanel";
import { AniListSearchCard, MoreSearchCard } from "./SearchCards";
import { SearchNoMatches } from "./SearchNoMatches";
import { peopleFor, SearchPeople } from "./SearchPeople";
import { SearchStartPage } from "./SearchStartPage";
import { SearchTopResult } from "./SearchTopResult";
import { catalogFilterChips, moreFilterChips } from "./search-filter-chips";
import { genreArtwork } from "./search-genres";
import {
  keepFilters,
  keepMoreFilters,
  keepQuery,
  rememberedFilters,
  rememberedMoreFilters,
  rememberedQuery,
} from "./search-memory";
import {
  didYouMeanQuery,
  filterOptionsQuery,
  personTitlesQuery,
  searchResultsQuery,
  searchTrendingQuery,
  type SearchResults as Results,
  type SearchScope,
} from "./search-queries";
import type { ViewerAccess } from "./viewer-access";

export type { SearchScope } from "./search-queries";

const DEBOUNCE_MS = 300;
/** Typing has stopped this long before an empty search may say "No matches". */
const IDLE_MS = 1_000;
const MIN_QUERY = 2;

const SCOPES: ReadonlyArray<{ id: SearchScope; label: string }> = [
  { id: "ANIME", label: "Anime" },
  { id: "MANGA", label: "Manga" },
  { id: "MORE", label: "Movies & TV" },
];

const COPY: Record<SearchScope, { placeholder: string; noun: string }> = {
  ANIME: { placeholder: "Search anime by title, studio or character", noun: "anime" },
  MANGA: { placeholder: "Search manga, manhwa and manhua by title or character", noun: "manga" },
  MORE: { placeholder: "Search movies and shows", noun: "movies and shows" },
};

export { presetSearchGenre } from "./search-memory";

/** Keeps the person-titles query's shape while no studio or character is open (it stays off). */
const PLACEHOLDER_PERSON: AniListSearchPerson = { kind: "studio", id: 0, name: "" };

type PersonView = {
  /** The search it was opened from; a new search leaves it. */
  query: string;
  person: AniListSearchPerson;
  items?: AniListCatalogMedia[];
  error?: string;
};

/**
 * Search (redesign 2026-10-20; mockups and research in prototypes/mockups/search-v2/). One
 * section at a time, chosen with the Anime · Manga · Movies & TV switch beside the field (user
 * decision: no "All", so anime never repeats as TMDB entries and each keystroke pause costs one
 * request). Results appear while typing; an empty field shows recent searches (kept on the
 * device), genre tiles and what is trending. Anime and manga results point to the other section
 * when it has matches; an empty Anime or Manga search offers Movies & TV (sent to TMDB only when
 * pressed) and, for a typo, the likely title.
 */
export function SectionSearch({
  scope,
  access,
  onScopeChange,
  onOpenMedia,
  onPrimaryMedia,
  onLibrary,
  onOpenMore,
  onPrimaryMore,
}: {
  scope: SearchScope;
  access: ViewerAccess;
  onScopeChange: (scope: SearchScope) => void;
  onOpenMedia: (media: AniListCatalogMedia) => void;
  onPrimaryMedia: (media: AniListCatalogMedia) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
  onOpenMore: (item: MoreCatalogItem) => void;
  onPrimaryMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const copy = COPY[scope];
  const { rememberSearches } = useAppPreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLFormElement>(null);
  const [query, setQueryState] = useState(() => rememberedQuery(scope));
  const setQuery = (next: string): void => {
    keepQuery(scope, next);
    setQueryState(next);
  };
  const [submitted, setSubmitted] = useState(() => {
    const kept = rememberedQuery(scope).trim();
    return kept.length >= MIN_QUERY ? kept : "";
  });
  const recent = useRecentSearches(scope);
  const [savedMore, setSavedMore] = useState<Set<string>>(new Set());
  const catalogScope = scope === "MORE" ? undefined : scope;
  const [filters, setFilters] = useState<CatalogFilterState>(() =>
    catalogScope ? rememberedFilters(catalogScope) : emptyFilters(),
  );
  const [moreFilters, setMoreFilters] = useState<MoreBrowseFilters>(rememberedMoreFilters);
  const moreFiltered =
    scope === "MORE" &&
    (moreFilterCount(moreFilters) > 0 || moreFilters.sort !== DEFAULT_MORE_SORT);
  const filterCount = catalogScope ? activeFilterCount(filters) : moreFilterCount(moreFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [personState, setPerson] = useState<Pick<PersonView, "query" | "person">>();
  // Filters (or a non-default sort) browse the catalog even with an empty search field.
  const browsing = catalogScope ? filterCount > 0 || filters.sort !== DEFAULT_SORT : moreFiltered;
  const searchKey =
    submitted || browsing
      ? `${submitted}|${catalogScope ? filterKey(filters) : JSON.stringify(moreFilters)}`
      : "";

  const updateFilters = (next: CatalogFilterState): void => {
    if (catalogScope) keepFilters(catalogScope, next);
    setFilters(next);
  };
  const updateMoreFilters = (next: MoreBrowseFilters): void => {
    keepMoreFilters(next);
    setMoreFilters(next);
  };

  const filterOptions = useQuery({ ...filterOptionsQuery(), enabled: Boolean(catalogScope) }).data;

  useEffect(() => inputRef.current?.focus(), []);

  // Typing anywhere on the page goes into the field (TV-style: the field is always the target).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounce typing into a submitted query.
  useEffect(() => {
    const normalized = query.trim();
    const timer = window.setTimeout(
      () => setSubmitted(normalized.length >= MIN_QUERY ? normalized : ""),
      normalized.length >= MIN_QUERY ? DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  // Results change as you type, so an empty answer mid-word is not final: "No matches" (and its
  // "did you mean" lookup) waits until typing stops or Enter is pressed.
  const [idleQuery, setIdleQuery] = useState(submitted);
  useEffect(() => {
    const timer = window.setTimeout(() => setIdleQuery(query.trim()), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trending = useQuery(searchTrendingQuery(scope)).data;

  useEffect(() => {
    if (scope !== "MORE") return;
    void window.anistream
      .getMoreLibrary()
      .then((library) => setSavedMore(new Set(library.watchlist.map(moreKey))))
      .catch(() => undefined);
  }, [scope]);

  // Each search (query plus filters) has its own cache entry, so a late answer never shows under
  // another search.
  const resultsQuery = useInfiniteQuery({
    ...searchResultsQuery({ scope, query: submitted, filters, moreFilters, moreFiltered }),
    enabled: Boolean(searchKey),
  });
  const loadingMore = resultsQuery.isFetchingNextPage;

  const showingResults = Boolean(searchKey);
  // A failed "Show more" keeps the results shown; the button stays for another try.
  const current = showingResults
    ? resultsQuery.data
      ? { data: resultsQuery.data }
      : resultsQuery.error
        ? {
            error: friendlyRemoteError(resultsQuery.error, {
              provider: scope === "MORE" ? "TMDB" : "AniList",
              operation: "search results",
              fallback: "Search is unavailable right now. Try again shortly.",
            }),
          }
        : undefined
    : undefined;
  // Placeholder data is the previous search, kept on screen while this one loads.
  const pending = showingResults && (!current || resultsQuery.isPlaceholderData);
  /** The search the shown results answer: the previous one while the next is loading. */
  const shownQuery = current?.data?.query ?? submitted;
  const count = current?.data?.items.length ?? 0;
  const noMatches = Boolean(showingResults && current?.data && !pending && !count);
  // AniList matches whole words only ("Frie" finds nothing, "Frieren" does), so a short single
  // word is probably still being typed: hint instead of declaring "no matches" (2026-10-20). The
  // same while typing continues (2026-10-28, results update under the field).
  const [enteredQuery, setEnteredQuery] = useState("");
  const shortSingleWord =
    Boolean(catalogScope) && !filterCount && !submitted.includes(" ") && submitted.length < 6;
  const looksUnfinished =
    enteredQuery !== submitted && (idleQuery !== submitted || shortSingleWord);

  // "Did you mean": only for an unfiltered Anime/Manga search that found nothing. One extra
  // AniList lookup on the first word, by popularity; accepted only within two typos.
  const didYouMeanTitle = useQuery({
    ...didYouMeanQuery(catalogScope ?? "ANIME", submitted),
    enabled:
      noMatches &&
      !looksUnfinished &&
      Boolean(catalogScope) &&
      filterCount === 0 &&
      (submitted.split(/\s+/)[0] ?? "").length >= MIN_QUERY,
  }).data;
  const didYouMean = didYouMeanTitle ? { query: submitted, title: didYouMeanTitle } : undefined;

  const loadMore = (): void => {
    if (!resultsQuery.isFetching) void resultsQuery.fetchNextPage();
  };

  const remember = (): void => addRecentSearch(scope, query, rememberSearches);

  const toggleMore = (item: MoreCatalogItem): void => {
    const saved = !savedMore.has(moreKey(item));
    setSavedMore((currentSet) => {
      const next = new Set(currentSet);
      if (saved) next.add(moreKey(item));
      else next.delete(moreKey(item));
      return next;
    });
    void window.anistream.setMoreWatchlist(moreSnapshot(item), saved).catch(() => undefined);
  };

  const switchScope = (next: SearchScope, nextQuery = query): void => {
    if (next === scope) return;
    keepQuery(next, nextQuery);
    onScopeChange(next);
  };

  const openPerson = (next: AniListSearchPerson): void => {
    if (!catalogScope) return;
    remember();
    setPerson({ query: submitted, person: next });
  };

  // ---------------------------------------------------------------- what is shown
  const openedPerson = personState?.query === submitted ? personState : undefined;
  const personTitles = useQuery({
    ...personTitlesQuery(openedPerson?.person ?? PLACEHOLDER_PERSON, catalogScope ?? "ANIME"),
    enabled: Boolean(openedPerson && catalogScope),
  });
  const person: PersonView | undefined = openedPerson && {
    ...openedPerson,
    items: personTitles.data,
    error: personTitles.error
      ? friendlyRemoteError(personTitles.error, {
          provider: "AniList",
          operation: "titles",
          fallback: "Their titles are unavailable right now.",
        })
      : undefined,
  };
  // The start page (recent, genres, Trending) stays, dimmed, until the first search answers.
  const startShown = !person && (!showingResults || !current);
  const grid: Results | undefined = person
    ? person.items
      ? { kind: "anilist", items: person.items, page: 1, hasNext: false }
      : undefined
    : startShown
      ? trending
      : current?.data;
  const extras = grid?.kind === "anilist" && !person ? grid.extras : undefined;
  const topAniList =
    !startShown &&
    !person &&
    shownQuery &&
    grid?.kind === "anilist" &&
    grid.items[0] &&
    isConfidentMatch(shownQuery, grid.items[0].title)
      ? grid.items[0]
      : undefined;
  const topMore =
    !startShown &&
    !person &&
    shownQuery &&
    grid?.kind === "more" &&
    grid.items[0] &&
    isConfidentMatch(shownQuery, grid.items[0].title)
      ? grid.items[0]
      : undefined;
  const hasMore =
    !person &&
    (grid?.kind === "anilist"
      ? grid.hasNext
      : Boolean(grid?.kind === "more" && grid.next && Object.keys(grid.next).length));

  function submitAll(): void {
    const normalized = query.trim();
    if (normalized.length >= MIN_QUERY) {
      setSubmitted(normalized);
      setEnteredQuery(normalized);
      remember();
    }
  }

  // Applied filters as removable chips under the field.
  const chips = catalogScope
    ? catalogFilterChips(filters, updateFilters)
    : moreFilterChips(moreFilters, updateMoreFilters);
  const clearFilters = (): void =>
    catalogScope ? updateFilters(emptyFilters()) : updateMoreFilters(emptyMoreFilters());

  const pickGenre = (genre: string): void => {
    if (catalogScope) updateFilters({ ...emptyFilters(), genre });
    else updateMoreFilters({ ...emptyMoreFilters(), genre });
  };
  const genreArt = genreArtwork(scope, trending);

  const member = access.kind === "member";
  const renderPoster = (
    item: AniListCatalogMedia | MoreCatalogItem,
    index: number,
  ): React.ReactNode => {
    if ("siteUrl" in item && "voteCount" in item === false && grid?.kind === "more") return null;
    if (grid?.kind === "more") {
      const more = item as MoreCatalogItem;
      return (
        <MoreSearchCard
          key={moreKey(more)}
          item={more}
          index={index}
          detailed
          saved={savedMore.has(moreKey(more))}
          onToggleSaved={() => toggleMore(more)}
          onOpen={() => {
            remember();
            onOpenMore(more);
          }}
          onPrimary={() => {
            remember();
            onPrimaryMore(more);
          }}
        />
      );
    }
    const media = item as AniListCatalogMedia;
    return (
      <AniListSearchCard
        key={media.id}
        media={media}
        scope={scope === "MANGA" ? "MANGA" : "ANIME"}
        index={index}
        detailed
        saved={member ? access.libraryEntries.has(media.id) : undefined}
        onToggleSaved={member ? () => void onLibrary(media) : undefined}
        onOpen={() => {
          remember();
          onOpenMedia(media);
        }}
        onPrimary={() => {
          remember();
          onPrimaryMedia(media);
        }}
      />
    );
  };

  const gridItems: Array<AniListCatalogMedia | MoreCatalogItem> =
    grid?.kind === "anilist"
      ? grid.items.filter((media) => media !== topAniList)
      : grid?.kind === "more"
        ? grid.items.filter((item) => item !== topMore)
        : [];

  const otherLabel = extras?.otherType === "MANGA" ? "Manga" : "Anime";
  const glow = topAniList?.coverColor;

  return (
    <section
      className="section-search"
      aria-label={`Search ${copy.noun}`}
      style={glow ? ({ "--search-glow": glow } as React.CSSProperties) : undefined}
    >
      <div className="section-search-glow" aria-hidden="true" />
      <div className="section-search-bar">
        <form
          ref={fieldRef}
          className="section-search-field"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (topAniList) {
              remember();
              onOpenMedia(topAniList);
            } else if (topMore) {
              remember();
              onOpenMore(topMore);
            } else submitAll();
          }}
        >
          <Search size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            maxLength={100}
            placeholder={copy.placeholder}
            aria-label={`Search ${copy.noun}`}
            aria-controls="search-results"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                // Results update under the field as you type; Down moves into them (the top
                // result's Watch first).
                event.preventDefault();
                document
                  .querySelector<HTMLElement>(
                    ".section-search-results .more-poster-hit, .section-search-results button",
                  )
                  ?.focus();
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="section-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setPerson(undefined);
                inputRef.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          ) : (
            <kbd className="section-search-kbd" aria-hidden="true">
              Ctrl K
            </kbd>
          )}
        </form>
        <div className="section-search-scopes" role="radiogroup" aria-label="Search in">
          {SCOPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === scope}
              className={entry.id === scope ? "is-on" : undefined}
              onClick={() => switchScope(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`section-search-filters-button${filterCount ? " is-on" : ""}`}
          aria-haspopup="dialog"
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          Filters
          {filterCount ? <b aria-label={`${filterCount} on`}>{filterCount}</b> : null}
        </button>
      </div>

      {chips.length ? (
        <div className="section-search-chips" aria-label="Filters in use">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="is-filter"
              onClick={chip.remove}
              aria-label={`Remove ${chip.label}`}
            >
              {chip.label}
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="is-clear" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      <div
        id="search-results"
        className={`section-search-results${pending ? " is-pending" : ""}`}
        aria-busy={pending}
      >
        {startShown ? (
          <SearchStartPage
            scope={scope}
            recent={recent}
            rememberSearches={rememberSearches}
            genreArt={genreArt}
            onSearch={setQuery}
            onPickGenre={pickGenre}
          >
            {gridItems.map(renderPoster)}
          </SearchStartPage>
        ) : (
          <>
            {person ? (
              <div className="section-search-head section-search-person-head">
                <h2>
                  {person.person.kind === "studio" ? "Made by" : "With"} {person.person.name}
                </h2>
                <button
                  type="button"
                  className="section-search-link"
                  onClick={() => setPerson(undefined)}
                >
                  Back to results
                </button>
              </div>
            ) : null}
            {person?.error || current?.error ? (
              <p className="error-banner">{person?.error ?? current?.error}</p>
            ) : null}

            {topAniList ? (
              <SearchTopResult
                image={topAniList.bannerUrl ?? topAniList.coverUrl}
                cover={topAniList.coverUrl}
                tint={topAniList.coverColor}
                kicker={`Top result · ${scope === "ANIME" ? "Anime" : "Manga"}`}
                title={topAniList.title}
                meta={[
                  formatMediaLabel(topAniList.format, scope === "ANIME" ? "Anime" : "Manga"),
                  topAniList.seasonYear,
                  topAniList.totalProgress
                    ? `${topAniList.totalProgress} ${scope === "ANIME" ? "episodes" : "chapters"}`
                    : undefined,
                  topAniList.averageScore ? `${topAniList.averageScore}%` : undefined,
                ]}
                progress={(() => {
                  const entry = member ? access.libraryEntries.get(topAniList.id) : undefined;
                  return entry
                    ? `In your list · ${scope === "ANIME" ? "Ep" : "Ch"} ${entry.progress}`
                    : undefined;
                })()}
                description={topAniList.description}
                primaryLabel={scope === "MANGA" ? "Read" : "Watch"}
                onPrimary={() => {
                  remember();
                  onPrimaryMedia(topAniList);
                }}
                onDetails={() => {
                  remember();
                  onOpenMedia(topAniList);
                }}
                onAdd={member ? () => void onLibrary(topAniList) : undefined}
              />
            ) : topMore ? (
              <SearchTopResult
                image={topMore.backdropUrl ?? topMore.posterUrl}
                cover={topMore.posterUrl}
                tint={undefined}
                kicker={`Top result · ${topMore.type === "MOVIE" ? "Movie" : "Series"}`}
                title={topMore.title}
                meta={[
                  topMore.year,
                  formatScore(topMore.score) ? `${formatScore(topMore.score)} TMDB` : undefined,
                ]}
                description={topMore.overview}
                primaryLabel="Play"
                onPrimary={() => {
                  remember();
                  onPrimaryMore(topMore);
                }}
                onDetails={() => {
                  remember();
                  onOpenMore(topMore);
                }}
              />
            ) : null}

            {grid && gridItems.length ? (
              <section className="section-search-block">
                <div className="section-search-head">
                  <h2>
                    {person
                      ? "Titles"
                      : topAniList || topMore
                        ? "More results"
                        : submitted
                          ? "Results"
                          : `Browse ${copy.noun}`}
                  </h2>
                  <small role="status">
                    {pending
                      ? "Searching…"
                      : `${grid.items.length}${hasMore ? "+" : ""} ${copy.noun}`}
                  </small>
                  {extras && extras.otherCount > 0 && submitted ? (
                    <button
                      type="button"
                      className="section-search-also"
                      onClick={() => switchScope(extras.otherType, submitted)}
                    >
                      Also {extras.otherCount}
                      {extras.otherCount >= extras.otherLimit ? "+" : ""} in {otherLabel}
                    </button>
                  ) : null}
                </div>
                <div className="section-search-grid">{gridItems.map(renderPoster)}</div>
              </section>
            ) : null}

            {grid?.kind === "anilist" &&
            !person &&
            submitted &&
            peopleFor(grid, submitted).length ? (
              <SearchPeople people={peopleFor(grid, submitted)} onOpen={openPerson} />
            ) : null}

            {noMatches && !person && looksUnfinished ? (
              <p className="section-search-keep-typing" role="status">
                {catalogScope
                  ? `Keep typing: titles match by whole words. Press Enter to search “${submitted}” anyway.`
                  : `Keep typing, or press Enter to search “${submitted}”.`}
              </p>
            ) : null}
            {noMatches && !person && !looksUnfinished ? (
              <SearchNoMatches
                query={submitted}
                noun={copy.noun}
                filtered={filterCount > 0}
                didYouMean={didYouMean?.query === submitted ? didYouMean.title : undefined}
                otherSection={
                  extras && extras.otherCount > 0
                    ? { label: otherLabel, count: extras.otherCount }
                    : undefined
                }
                onSearch={setQuery}
                onClearFilters={clearFilters}
                onSearchMore={
                  catalogScope && submitted ? () => switchScope("MORE", submitted) : undefined
                }
                onOtherSection={() => extras && switchScope(extras.otherType, submitted)}
              />
            ) : null}
            {noMatches && !person && !looksUnfinished && trending ? (
              <section className="section-search-block">
                <div className="section-search-head">
                  <h2>Trending now</h2>
                  <small>In case it is one of these</small>
                </div>
                <div className="section-search-grid">
                  {(trending.kind === "anilist" ? trending.items : trending.items)
                    .slice(0, 8)
                    .map((item, index) =>
                      trending.kind === "anilist"
                        ? renderTrendingAniList(item as AniListCatalogMedia, index)
                        : renderTrendingMore(item as MoreCatalogItem, index),
                    )}
                </div>
              </section>
            ) : null}
          </>
        )}
        {showingResults && hasMore ? (
          <button
            className="section-search-more"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Show more results"}
          </button>
        ) : null}
      </div>

      {filtersOpen ? (
        catalogScope ? (
          <SearchFiltersPanel
            kind="anilist"
            type={catalogScope}
            value={filters}
            options={filterOptions}
            onApply={updateFilters}
            onClose={() => setFiltersOpen(false)}
          />
        ) : (
          <SearchFiltersPanel
            kind="more"
            value={moreFilters}
            onApply={updateMoreFilters}
            onClose={() => setFiltersOpen(false)}
          />
        )
      ) : null}
    </section>
  );

  function renderTrendingAniList(media: AniListCatalogMedia, index: number): React.ReactNode {
    return (
      <AniListSearchCard
        key={`t${media.id}`}
        media={media}
        scope={scope === "MANGA" ? "MANGA" : "ANIME"}
        index={index}
        onOpen={() => onOpenMedia(media)}
        onPrimary={() => onPrimaryMedia(media)}
      />
    );
  }

  function renderTrendingMore(item: MoreCatalogItem, index: number): React.ReactNode {
    return (
      <MoreSearchCard
        key={`t${moreKey(item)}`}
        item={item}
        index={index}
        onOpen={() => onOpenMore(item)}
        onPrimary={() => onPrimaryMore(item)}
      />
    );
  }
}
