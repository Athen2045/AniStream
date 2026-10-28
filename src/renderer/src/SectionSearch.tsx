import { Clock3, Info, Play, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListSearchPerson,
  MoreCatalogItem,
} from "../../shared/contracts";
import {
  COUNTRY_LABELS,
  FORMAT_LABELS,
  SEASON_LABELS,
  STATUS_LABELS,
} from "../../shared/anilist-filters";
import { cachedArtworkUrl } from "../../shared/artwork";
import {
  MORE_LANGUAGES,
  MORE_SORT_LABELS,
  moreFilterCount,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import { useAppPreferences } from "./app-preferences";
import {
  DEFAULT_SORT,
  SORT_LABELS,
  activeFilterCount,
  emptyFilters,
  filterKey,
  type CatalogFilterState,
} from "./catalog-filters";
import { CoverImage } from "./CoverImage";
import { formatMediaLabel } from "./format-label";
import { HoverPoster } from "./HoverPoster";
import { DEFAULT_MORE_SORT, emptyMoreFilters } from "./more-filter-state";
import { formatScore, moreKey, moreSnapshot, releaseState } from "./more-format";
import {
  addRecentSearch,
  clearRecentSearches,
  removeRecentSearch,
  useRecentSearches,
} from "./recent-searches";
import { friendlyRemoteError } from "./remote-error";
import { isConfidentMatch, searchNormalize } from "./search-helpers";
import { SearchFiltersPanel } from "./SearchFiltersPanel";
import {
  didYouMeanQuery,
  filterOptionsQuery,
  personTitlesQuery,
  searchResultsQuery,
  searchTrendingQuery,
  type SearchResults as Results,
  type SearchScope,
} from "./search-queries";
import { titleTintStyle } from "./title-accent";
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

/** Genre tiles before typing: the tint behind each, and the AniList / TMDB genre it filters. */
const GENRE_TILES: Record<SearchScope, ReadonlyArray<{ genre: string; color: string }>> = {
  ANIME: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Fantasy", color: "#6d28d9" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Sci-Fi", color: "#0369a1" },
    { genre: "Slice of Life", color: "#15803d" },
    { genre: "Horror", color: "#7f1d1d" },
    { genre: "Sports", color: "#0f766e" },
  ],
  MANGA: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Fantasy", color: "#6d28d9" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Drama", color: "#0369a1" },
    { genre: "Slice of Life", color: "#15803d" },
    { genre: "Mystery", color: "#4c1d95" },
    { genre: "Horror", color: "#7f1d1d" },
  ],
  MORE: [
    { genre: "Action", color: "#c2410c" },
    { genre: "Comedy", color: "#ca8a04" },
    { genre: "Drama", color: "#0369a1" },
    { genre: "Sci-Fi", color: "#6d28d9" },
    { genre: "Crime", color: "#7f1d1d" },
    { genre: "Romance", color: "#be185d" },
    { genre: "Documentary", color: "#15803d" },
    { genre: "Family", color: "#0f766e" },
  ],
};

/** The query in each section's field, so returning from a title shows the same search. */
const queryByScope: Record<SearchScope, string> = { ANIME: "", MANGA: "", MORE: "" };
/** Filters are remembered per section for this app session. */
const filtersByScope: Record<"ANIME" | "MANGA", CatalogFilterState> = {
  ANIME: emptyFilters(),
  MANGA: emptyFilters(),
};
let moreFiltersState: MoreBrowseFilters = emptyMoreFilters();
function keepQuery(scope: SearchScope, query: string): void {
  queryByScope[scope] = query;
}
function keepFilters(scope: "ANIME" | "MANGA", filters: CatalogFilterState): void {
  filtersByScope[scope] = filters;
}
function keepMoreFilters(filters: MoreBrowseFilters): void {
  moreFiltersState = filters;
}

/** Makes the next Search page in `scope` open on one genre (a Genre row's View all). */
export function presetSearchGenre(scope: SearchScope, genre: string): void {
  keepQuery(scope, "");
  if (scope === "MORE") keepMoreFilters({ ...emptyMoreFilters(), genre });
  else keepFilters(scope, { ...emptyFilters(), genre });
}

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
  const [query, setQueryState] = useState(() => queryByScope[scope]);
  const setQuery = (next: string): void => {
    keepQuery(scope, next);
    setQueryState(next);
  };
  const [submitted, setSubmitted] = useState(() =>
    queryByScope[scope].trim().length >= MIN_QUERY ? queryByScope[scope].trim() : "",
  );
  const recent = useRecentSearches(scope);
  const [savedMore, setSavedMore] = useState<Set<string>>(new Set());
  const catalogScope = scope === "MORE" ? undefined : scope;
  const [filters, setFilters] = useState<CatalogFilterState>(() =>
    catalogScope ? filtersByScope[catalogScope] : emptyFilters(),
  );
  const [moreFilters, setMoreFilters] = useState<MoreBrowseFilters>(() => moreFiltersState);
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
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (catalogScope) {
    const without = (key: keyof CatalogFilterState) => () => {
      const next = { ...filters };
      delete next[key];
      updateFilters(next);
    };
    if (filters.genre) chips.push({ key: "genre", label: filters.genre, remove: without("genre") });
    if (filters.format)
      chips.push({
        key: "format",
        label: FORMAT_LABELS[filters.format],
        remove: without("format"),
      });
    if (filters.status)
      chips.push({
        key: "status",
        label: STATUS_LABELS[filters.status],
        remove: without("status"),
      });
    if (filters.season)
      chips.push({
        key: "season",
        label: SEASON_LABELS[filters.season],
        remove: without("season"),
      });
    if (filters.year !== undefined)
      chips.push({ key: "year", label: String(filters.year), remove: without("year") });
    if (filters.country)
      chips.push({
        key: "country",
        label: COUNTRY_LABELS[filters.country],
        remove: without("country"),
      });
    if (filters.tag) chips.push({ key: "tag", label: filters.tag, remove: without("tag") });
    if (filters.minScore !== undefined)
      chips.push({
        key: "score",
        label: `Score ${filters.minScore / 10}+`,
        remove: without("minScore"),
      });
    if (filters.sort !== DEFAULT_SORT)
      chips.push({
        key: "sort",
        label: SORT_LABELS[filters.sort],
        remove: () => updateFilters({ ...filters, sort: DEFAULT_SORT }),
      });
  } else {
    const without = (key: keyof MoreBrowseFilters) => () => {
      const next = { ...moreFilters };
      delete next[key];
      updateMoreFilters(next);
    };
    if (moreFilters.type)
      chips.push({
        key: "type",
        label: moreFilters.type === "MOVIE" ? "Movies" : "Shows",
        remove: without("type"),
      });
    if (moreFilters.genre)
      chips.push({ key: "genre", label: moreFilters.genre, remove: without("genre") });
    if (moreFilters.language)
      chips.push({
        key: "language",
        label:
          MORE_LANGUAGES.find((row) => row.code === moreFilters.language)?.label ??
          moreFilters.language,
        remove: without("language"),
      });
    if (moreFilters.year !== undefined)
      chips.push({ key: "year", label: String(moreFilters.year), remove: without("year") });
    if (moreFilters.minScore !== undefined)
      chips.push({
        key: "score",
        label: `Score ${moreFilters.minScore}+`,
        remove: without("minScore"),
      });
    if (moreFilters.sort !== DEFAULT_MORE_SORT)
      chips.push({
        key: "sort",
        label: MORE_SORT_LABELS[moreFilters.sort as MoreSort],
        remove: () => updateMoreFilters({ ...moreFilters, sort: DEFAULT_MORE_SORT }),
      });
  }
  const clearFilters = (): void =>
    catalogScope ? updateFilters(emptyFilters()) : updateMoreFilters(emptyMoreFilters());

  const pickGenre = (genre: string): void => {
    if (catalogScope) updateFilters({ ...emptyFilters(), genre });
    else updateMoreFilters({ ...emptyMoreFilters(), genre });
  };
  // Each genre tile gets a different trending title's artwork (none rather than a repeat).
  const genreArt = new Map<string, string>();
  {
    const used = new Set<string>();
    for (const tile of GENRE_TILES[scope]) {
      const art =
        trending?.kind === "anilist"
          ? trending.items.find(
              (item) =>
                item.genres.includes(tile.genre) && item.bannerUrl && !used.has(item.bannerUrl),
            )?.bannerUrl
          : trending?.kind === "more"
            ? trending.items.find(
                (item) =>
                  // TMDB names the genre "Science Fiction"; the filter calls it "Sci-Fi".
                  (item.genres.includes(tile.genre) ||
                    (tile.genre === "Sci-Fi" && item.genres.includes("Science Fiction"))) &&
                  item.backdropUrl &&
                  !used.has(item.backdropUrl),
              )?.backdropUrl
            : undefined;
      if (art) {
        used.add(art);
        genreArt.set(tile.genre, art);
      }
    }
  }

  const member = access.kind === "member";
  const renderPoster = (
    item: AniListCatalogMedia | MoreCatalogItem,
    index: number,
  ): React.ReactNode => {
    if ("siteUrl" in item && "voteCount" in item === false && grid?.kind === "more") return null;
    if (grid?.kind === "more") {
      const more = item as MoreCatalogItem;
      return (
        <div className="search-card" key={moreKey(more)} data-search-card={index}>
          <HoverPoster
            title={more.title}
            imageUrl={more.posterUrl}
            score={formatScore(more.score)}
            meta={[more.year, more.type === "MOVIE" ? "Movie" : "Series"]}
            releaseLabel={releaseState(more.releaseDate).label}
            saved={savedMore.has(moreKey(more))}
            onOpen={() => {
              remember();
              onOpenMore(more);
            }}
            onPrimary={() => {
              remember();
              onPrimaryMore(more);
            }}
            onToggleSaved={() => toggleMore(more)}
          />
          <b title={more.title}>{more.title}</b>
          <small>
            {[more.type === "MOVIE" ? "Movie" : "Series", more.year, formatScore(more.score)]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
      );
    }
    const media = item as AniListCatalogMedia;
    return (
      <div className="search-card" key={media.id} data-search-card={index}>
        <HoverPoster
          title={media.title}
          imageUrl={media.coverUrl}
          score={media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined}
          meta={[
            media.seasonYear,
            formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga"),
          ]}
          tag={formatTag(media.format)}
          primaryLabel={scope === "MANGA" ? "Read" : "Play"}
          saved={member ? access.libraryEntries.has(media.id) : undefined}
          onOpen={() => {
            remember();
            onOpenMedia(media);
          }}
          onPrimary={() => {
            remember();
            onPrimaryMedia(media);
          }}
          onToggleSaved={member ? () => void onLibrary(media) : undefined}
        />
        <b title={media.title}>{media.title}</b>
        <small>
          {[
            formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga"),
            media.seasonYear,
            media.averageScore ? `${media.averageScore}%` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
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
          <>
            {recent.length ? (
              <section className="section-search-block">
                <div className="section-search-head">
                  <h2>Recent</h2>
                  <small>{rememberSearches ? "On this device" : "This session"}</small>
                  <button
                    type="button"
                    className="section-search-link"
                    onClick={() => clearRecentSearches(scope)}
                  >
                    Clear
                  </button>
                </div>
                <div className="section-search-chips is-recent" aria-label="Recent searches">
                  {recent.map((entry) => (
                    <span key={entry} className="section-search-recent">
                      <button type="button" onClick={() => setQuery(entry)}>
                        <Clock3 size={14} aria-hidden="true" />
                        {entry}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${entry} from recent searches`}
                        onClick={() => removeRecentSearch(scope, entry)}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="section-search-block">
              <div className="section-search-head">
                <h2>Browse by genre</h2>
                <small>One click shows every title in it</small>
              </div>
              <div className="section-search-genres">
                {GENRE_TILES[scope].map((tile) => {
                  const art = genreArt.get(tile.genre);
                  return (
                    <button
                      key={tile.genre}
                      type="button"
                      className="section-search-genre"
                      style={{ "--genre": tile.color } as React.CSSProperties}
                      onClick={() => pickGenre(tile.genre)}
                    >
                      {art ? (
                        <img src={cachedArtworkUrl(art)} alt="" aria-hidden="true" loading="lazy" />
                      ) : null}
                      <span>{tile.genre}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="section-search-block">
              <div className="section-search-head">
                <h2>Trending now</h2>
              </div>
              <div className="section-search-grid">{gridItems.map(renderPoster)}</div>
            </section>
          </>
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
              <TopResult
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
              <TopResult
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
              <section className="section-search-block">
                <div className="section-search-head">
                  <h2>People &amp; studios</h2>
                </div>
                <div className="section-search-people">
                  {peopleFor(grid, submitted).map((row) => (
                    <button
                      key={`${row.kind}${row.id}`}
                      type="button"
                      onClick={() => openPerson(row)}
                    >
                      {row.imageUrl ? (
                        <CoverImage src={cachedArtworkUrl(row.imageUrl)} title={row.name} />
                      ) : (
                        <span className="section-search-initials" aria-hidden="true">
                          {row.name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((word) => word[0])
                            .join("")}
                        </span>
                      )}
                      <span>
                        <b>{row.name}</b>
                        <small>
                          {row.kind === "studio" ? "Studio" : `Character · ${row.knownFor ?? ""}`}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {noMatches && !person && looksUnfinished ? (
              <p className="section-search-keep-typing" role="status">
                {catalogScope
                  ? `Keep typing: titles match by whole words. Press Enter to search “${submitted}” anyway.`
                  : `Keep typing, or press Enter to search “${submitted}”.`}
              </p>
            ) : null}
            {noMatches && !person && !looksUnfinished ? (
              <section className="section-search-none">
                <h2>
                  {submitted ? `No matches for “${submitted}”` : "No titles match these filters"}
                </h2>
                <p>
                  {filterCount
                    ? "The filters may be too narrow. Remove one, or clear them all."
                    : `Nothing in ${copy.noun} by that name. Check the spelling, or try fewer words.`}
                </p>
                <div className="section-search-none-actions">
                  {didYouMean?.query === submitted ? (
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => setQuery(didYouMean.title)}
                    >
                      <Search size={17} aria-hidden="true" />
                      Search “{didYouMean.title}” instead
                    </button>
                  ) : null}
                  {filterCount ? (
                    <button type="button" onClick={clearFilters}>
                      Remove filters
                    </button>
                  ) : null}
                  {catalogScope && submitted ? (
                    <button type="button" onClick={() => switchScope("MORE", submitted)}>
                      Search Movies &amp; TV
                    </button>
                  ) : null}
                  {extras && extras.otherCount > 0 ? (
                    <button type="button" onClick={() => switchScope(extras.otherType, submitted)}>
                      Show {extras.otherCount} in {otherLabel}
                    </button>
                  ) : null}
                </div>
              </section>
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
      <div className="search-card" key={`t${media.id}`} data-search-card={index}>
        <HoverPoster
          title={media.title}
          imageUrl={media.coverUrl}
          score={media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined}
          meta={[
            media.seasonYear,
            formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga"),
          ]}
          tag={formatTag(media.format)}
          primaryLabel={scope === "MANGA" ? "Read" : "Play"}
          onOpen={() => onOpenMedia(media)}
          onPrimary={() => onPrimaryMedia(media)}
        />
        <b title={media.title}>{media.title}</b>
        <small>
          {[formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga"), media.seasonYear]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
    );
  }

  function renderTrendingMore(item: MoreCatalogItem, index: number): React.ReactNode {
    return (
      <div className="search-card" key={`t${moreKey(item)}`} data-search-card={index}>
        <HoverPoster
          title={item.title}
          imageUrl={item.posterUrl}
          score={formatScore(item.score)}
          meta={[item.year, item.type === "MOVIE" ? "Movie" : "Series"]}
          onOpen={() => onOpenMore(item)}
          onPrimary={() => onPrimaryMore(item)}
        />
        <b title={item.title}>{item.title}</b>
        <small>
          {[item.type === "MOVIE" ? "Movie" : "Series", item.year].filter(Boolean).join(" · ")}
        </small>
      </div>
    );
  }
}

/**
 * Characters and studios worth showing: when the query clearly names a title, only people whose
 * name is exactly the query (searching "ONE PIECE" should not list a side character).
 */
function peopleFor(
  results: Extract<Results, { kind: "anilist" }>,
  query: string,
): AniListSearchPerson[] {
  const people = results.extras?.people ?? [];
  const titled = results.items[0] && isConfidentMatch(query, results.items[0].title);
  if (!titled) return people;
  const wanted = searchNormalize(query);
  return people.filter((row) => searchNormalize(row.name) === wanted);
}

function TopResult({
  image,
  cover,
  tint,
  kicker,
  title,
  meta,
  progress,
  description,
  primaryLabel,
  onPrimary,
  onDetails,
  onAdd,
}: {
  image?: string;
  cover?: string;
  tint?: string;
  kicker: string;
  title: string;
  meta: ReadonlyArray<string | number | undefined>;
  progress?: string;
  description?: string;
  primaryLabel: string;
  onPrimary: () => void;
  onDetails: () => void;
  onAdd?: () => void;
}): React.JSX.Element {
  return (
    <article className="section-search-top" style={titleTintStyle(tint)}>
      {image ? (
        <img
          className="section-search-top-art"
          src={cachedArtworkUrl(image)}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      <div className="section-search-top-body">
        {cover ? (
          <CoverImage
            src={cachedArtworkUrl(cover)}
            title={title}
            className="section-search-top-cover"
          />
        ) : null}
        <div>
          <span className="section-search-kicker">{kicker}</span>
          <h2>{title}</h2>
          <p className="section-search-top-meta">
            {meta.filter((part) => part !== undefined && part !== "").join(" · ")}
            {progress ? <span className="is-progress"> · {progress}</span> : null}
          </p>
          {description ? <p className="section-search-top-desc">{description}</p> : null}
          <div className="section-search-top-actions">
            <button type="button" className="title-primary" onClick={onPrimary}>
              <Play size={18} fill="currentColor" aria-hidden="true" />
              {primaryLabel}
            </button>
            <button type="button" className="title-library" onClick={onDetails}>
              <Info size={18} aria-hidden="true" />
              Details
            </button>
            {onAdd ? (
              <button
                type="button"
                className="title-library title-round"
                aria-label="Add to list"
                onClick={onAdd}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function formatTag(format: string | undefined): string | undefined {
  switch (format) {
    case "MOVIE":
      return "Movie";
    case "SPECIAL":
      return "Special";
    case "OVA":
    case "ONA":
      return format;
    case "ONE_SHOT":
      return "One shot";
    case "NOVEL":
      return "Novel";
    default:
      return undefined;
  }
}
