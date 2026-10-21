import { Clock3, Info, Play, Plus, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListSearchExtras,
  AniListSearchPerson,
  MoreCatalogItem,
  MoreCatalogPage,
  MoreMediaType,
} from "../../shared/contracts";
import {
  COUNTRY_LABELS,
  FORMAT_LABELS,
  SEASON_LABELS,
  STATUS_LABELS,
  type AniListFilterOptions,
} from "../../shared/anilist-filters";
import { cachedArtworkUrl } from "../../shared/artwork";
import {
  MORE_LANGUAGES,
  MORE_SORT_LABELS,
  moreFilterCount,
  moreTypesFor,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import { useAppPreferences } from "./app-preferences";
import {
  DEFAULT_SORT,
  SORT_LABELS,
  activeFilterCount,
  browseInput,
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
import { closestTitle, highlightMatch, isConfidentMatch, searchNormalize } from "./search-helpers";
import { SearchFiltersPanel } from "./SearchFiltersPanel";
import { titleTintStyle } from "./title-accent";
import type { ViewerAccess } from "./viewer-access";

export type SearchScope = "ANIME" | "MANGA" | "MORE";

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const PAGE_SIZE = 30;
const TRENDING_SIZE = 16;
const SUGGESTION_TITLES = 4;

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
let filterOptionsRequest: Promise<AniListFilterOptions> | undefined;

function loadFilterOptions(): Promise<AniListFilterOptions> {
  filterOptionsRequest ??= window.anistream.getAniListFilterOptions().catch((reason: unknown) => {
    // Let a later visit try again instead of caching the failure.
    filterOptionsRequest = undefined;
    throw reason;
  });
  return filterOptionsRequest;
}

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

type Results =
  | {
      kind: "anilist";
      items: AniListCatalogMedia[];
      page: number;
      hasNext: boolean;
      extras?: AniListSearchExtras;
    }
  | {
      kind: "more";
      items: MoreCatalogItem[];
      /** Next page per type while filtered browsing has more. */
      next?: Partial<Record<MoreMediaType, number>>;
    };

/** One batch of filtered More pages (one per type) merged in the chosen order. */
async function browseMoreBatch(
  query: string,
  filters: MoreBrowseFilters,
  pages: Partial<Record<MoreMediaType, number>>,
): Promise<{ items: MoreCatalogItem[]; next: Partial<Record<MoreMediaType, number>> }> {
  const types = (Object.keys(pages) as MoreMediaType[]).filter((type) => pages[type]);
  const responses = await Promise.allSettled(
    types.map((type) =>
      window.anistream.browseMore({
        type,
        page: pages[type]!,
        sort: filters.sort,
        ...(query ? { query } : {}),
        ...(filters.genre ? { genre: filters.genre } : {}),
        ...(filters.language ? { language: filters.language } : {}),
        ...(filters.year !== undefined ? { year: filters.year } : {}),
        ...(filters.minScore !== undefined ? { minScore: filters.minScore } : {}),
      }),
    ),
  );
  const fulfilled: Array<[MoreMediaType, MoreCatalogPage]> = [];
  responses.forEach((response, index) => {
    if (response.status === "fulfilled") fulfilled.push([types[index], response.value]);
  });
  if (!fulfilled.length) {
    const failure = responses.find((response) => response.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  const next: Partial<Record<MoreMediaType, number>> = {};
  for (const [type, page] of fulfilled)
    if (page.pageInfo.hasNextPage) next[type] = page.pageInfo.currentPage + 1;
  return {
    items: mergeMore(
      fulfilled.map(([, page]) => page.items),
      filters.sort,
    ),
    next,
  };
}

/** Movies and shows together: alternating for popularity, by rating or date otherwise. */
function mergeMore(lists: MoreCatalogItem[][], sort: MoreSort): MoreCatalogItem[] {
  if (sort === "rated") return lists.flat().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (sort === "newest")
    return lists.flat().sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  const mixed: MoreCatalogItem[] = [];
  for (let index = 0; index < Math.max(0, ...lists.map((list) => list.length)); index += 1)
    for (const list of lists) if (list[index]) mixed.push(list[index]);
  return mixed;
}

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
  const [results, setResults] = useState<{ key: string; data?: Results; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [trending, setTrending] = useState<Results>();
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
  const [filterOptions, setFilterOptions] = useState<AniListFilterOptions>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [personState, setPerson] = useState<PersonView>();
  const [didYouMean, setDidYouMean] = useState<{ query: string; title: string }>();
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

  useEffect(() => {
    if (!catalogScope || filterOptions) return;
    let active = true;
    void loadFilterOptions()
      .then((options) => {
        if (active) setFilterOptions(options);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalogScope, filterOptions]);

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

  useEffect(() => {
    let active = true;
    const load: Promise<Results> =
      scope === "MORE"
        ? Promise.allSettled([
            window.anistream.getMoreTrending("MOVIE", 1),
            window.anistream.getMoreTrending("TV", 1),
          ]).then(([movies, shows]) => {
            const left = movies.status === "fulfilled" ? movies.value.items : [];
            const right = shows.status === "fulfilled" ? shows.value.items : [];
            const mixed: MoreCatalogItem[] = [];
            for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
              if (left[index]) mixed.push(left[index]);
              if (right[index]) mixed.push(right[index]);
            }
            return { kind: "more", items: mixed.slice(0, TRENDING_SIZE) };
          })
        : window.anistream
            .browseAniList({ type: scope, page: 1, perPage: TRENDING_SIZE, sort: "TRENDING_DESC" })
            .then((page) => ({ kind: "anilist", items: page.items, page: 1, hasNext: false }));
    void load
      .then((data) => {
        if (active) setTrending(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [scope]);

  useEffect(() => {
    if (scope !== "MORE") return;
    void window.anistream
      .getMoreLibrary()
      .then((library) => setSavedMore(new Set(library.watchlist.map(moreKey))))
      .catch(() => undefined);
  }, [scope]);

  useEffect(() => {
    if (!searchKey) return;
    let active = true;
    const search: Promise<Results> = moreFiltered
      ? browseMoreBatch(
          submitted,
          moreFilters,
          Object.fromEntries(moreTypesFor(moreFilters).map((type) => [type, 1])),
        ).then(({ items, next }): Results => ({ kind: "more", items, next }))
      : scope === "MORE"
        ? Promise.allSettled([
            window.anistream.searchMore(submitted, "MOVIE", 1),
            window.anistream.searchMore(submitted, "TV", 1),
          ]).then((responses) => {
            const fulfilled = responses.flatMap((response) =>
              response.status === "fulfilled" ? response.value.items : [],
            );
            if (!fulfilled.length) {
              const failure = responses.find((response) => response.status === "rejected");
              if (failure?.status === "rejected") throw failure.reason;
            }
            return {
              kind: "more",
              items: fulfilled.sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0)),
            };
          })
        : window.anistream
            .browseAniList(browseInput(scope, 1, PAGE_SIZE, submitted, filters))
            .then(toAniListResults);
    void search
      .then((data) => {
        if (active) setResults({ key: searchKey, data });
      })
      .catch((reason: unknown) => {
        if (active)
          setResults({
            key: searchKey,
            error: friendlyRemoteError(reason, {
              provider: scope === "MORE" ? "TMDB" : "AniList",
              operation: "search results",
              fallback: "Search is unavailable right now. Try again shortly.",
            }),
          });
      });
    return () => {
      active = false;
    };
    // `searchKey` already encodes `submitted` and `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, searchKey]);

  const showingResults = Boolean(searchKey);
  const current = showingResults && results?.key === searchKey ? results : undefined;
  const pending = showingResults && !current;
  const count = current?.data?.items.length ?? 0;
  const noMatches = Boolean(showingResults && current?.data && !count);
  // AniList matches whole words only ("Frie" finds nothing, "Frieren" does), so a short single
  // word is probably still being typed: hint instead of declaring "no matches" (2026-10-20).
  const [enteredQuery, setEnteredQuery] = useState("");
  const looksUnfinished =
    Boolean(catalogScope) &&
    !filterCount &&
    !submitted.includes(" ") &&
    submitted.length < 6 &&
    enteredQuery !== submitted;

  // "Did you mean": only for an unfiltered Anime/Manga search that found nothing. One extra
  // AniList lookup on the first word, by popularity; accepted only within two typos.
  useEffect(() => {
    if (!noMatches || looksUnfinished || !catalogScope || filterCount > 0 || !submitted) return;
    const first = submitted.split(/\s+/)[0] ?? "";
    if (first.length < MIN_QUERY) return;
    let active = true;
    void window.anistream
      .browseAniList({
        type: catalogScope,
        page: 1,
        perPage: 15,
        sort: "POPULARITY_DESC",
        query: first,
      })
      .then((page) => {
        const title = closestTitle(
          submitted,
          page.items.map((item) => item.title),
        );
        if (active && title) setDidYouMean({ query: submitted, title });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [catalogScope, filterCount, looksUnfinished, noMatches, submitted]);

  const loadMore = useCallback(async () => {
    if (results?.data?.kind === "more") {
      const next = results.data.next;
      if (!next || !Object.keys(next).length) return;
      setLoadingMore(true);
      try {
        const batch = await browseMoreBatch(submitted, moreFilters, next);
        setResults((state) => {
          if (state?.key !== results.key || state.data?.kind !== "more") return state;
          const seen = new Set(state.data.items.map(moreKey));
          return {
            ...state,
            data: {
              kind: "more",
              items: [
                ...state.data.items,
                ...batch.items.filter((item) => !seen.has(moreKey(item))),
              ],
              next: batch.next,
            },
          };
        });
      } catch {
        // Keep the results already shown; the button stays available for another try.
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    if (scope === "MORE" || results?.data?.kind !== "anilist" || !results.data.hasNext) return;
    const currentPage = results.data;
    setLoadingMore(true);
    try {
      const next = await window.anistream.browseAniList(
        browseInput(scope, currentPage.page + 1, PAGE_SIZE, submitted, filters),
      );
      setResults((state) =>
        state?.key === results.key && state.data?.kind === "anilist"
          ? {
              ...state,
              data: {
                ...state.data,
                items: [...state.data.items, ...next.items],
                page: next.pageInfo.currentPage,
                hasNext: next.pageInfo.hasNextPage,
              },
            }
          : state,
      );
    } catch {
      // Keep the results already shown; the button stays available for another try.
    } finally {
      setLoadingMore(false);
    }
  }, [filters, moreFilters, results, scope, submitted]);

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
    setSuggestOpen(false);
    setPerson({ query: submitted, person: next });
    void window.anistream
      .getAniListPersonTitles(next.kind, next.id, catalogScope)
      .then((items) =>
        setPerson((state) => (state?.person.id === next.id ? { ...state, items } : state)),
      )
      .catch((reason: unknown) =>
        setPerson((state) =>
          state?.person.id === next.id
            ? {
                ...state,
                error: friendlyRemoteError(reason, {
                  provider: "AniList",
                  operation: "titles",
                  fallback: "Their titles are unavailable right now.",
                }),
              }
            : state,
        ),
      );
  };

  // ---------------------------------------------------------------- what is shown
  const person = personState?.query === submitted ? personState : undefined;
  const grid: Results | undefined = person
    ? person.items
      ? { kind: "anilist", items: person.items, page: 1, hasNext: false }
      : undefined
    : showingResults
      ? current?.data
      : trending;
  const extras = grid?.kind === "anilist" && !person ? grid.extras : undefined;
  const topAniList =
    !person &&
    submitted &&
    grid?.kind === "anilist" &&
    grid.items[0] &&
    isConfidentMatch(submitted, grid.items[0].title)
      ? grid.items[0]
      : undefined;
  const topMore =
    !person &&
    submitted &&
    grid?.kind === "more" &&
    grid.items[0] &&
    isConfidentMatch(submitted, grid.items[0].title)
      ? grid.items[0]
      : undefined;
  const hasMore =
    !person &&
    (grid?.kind === "anilist"
      ? grid.hasNext
      : Boolean(grid?.kind === "more" && grid.next && Object.keys(grid.next).length));

  // Suggestions: recent searches that match, the first titles, and matching people.
  const suggestionRecents = useMemo(
    () =>
      query.trim().length >= 1
        ? recent
            .filter((entry) => entry.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .filter((entry) => entry.toLocaleLowerCase() !== query.trim().toLocaleLowerCase())
            .slice(0, 2)
        : [],
    [query, recent],
  );
  const freshResults = current?.data && submitted === query.trim() ? current.data : undefined;
  const suggestionTitles: Array<{
    key: string;
    title: string;
    image?: string;
    meta: string;
    open: () => void;
  }> =
    freshResults?.kind === "anilist"
      ? freshResults.items.slice(0, SUGGESTION_TITLES).map((media) => ({
          key: `a${media.id}`,
          title: media.title,
          image: media.coverUrl,
          meta: [
            formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga"),
            media.seasonYear,
          ]
            .filter(Boolean)
            .join(" · "),
          open: () => {
            remember();
            onOpenMedia(media);
          },
        }))
      : freshResults?.kind === "more"
        ? freshResults.items.slice(0, SUGGESTION_TITLES).map((item) => ({
            key: moreKey(item),
            title: item.title,
            image: item.posterUrl,
            meta: [item.type === "MOVIE" ? "Movie" : "Series", item.year]
              .filter(Boolean)
              .join(" · "),
            open: () => {
              remember();
              onOpenMore(item);
            },
          }))
        : [];
  const suggestionPeople =
    freshResults?.kind === "anilist" ? peopleFor(freshResults, query.trim()).slice(0, 2) : [];
  const suggestionRows = [
    ...suggestionRecents.map((entry) => ({ key: `r${entry}`, run: () => setQuery(entry) })),
    ...suggestionTitles.map((row) => ({ key: row.key, run: row.open })),
    ...suggestionPeople.map((row) => ({
      key: `p${row.kind}${row.id}`,
      run: () => openPerson(row),
    })),
    { key: "all", run: () => submitAll() },
  ];
  const showSuggestions =
    suggestOpen &&
    query.trim().length >= MIN_QUERY &&
    (suggestionRecents.length > 0 || suggestionTitles.length > 0);

  function submitAll(): void {
    const normalized = query.trim();
    setSuggestOpen(false);
    setHighlight(-1);
    if (normalized.length >= MIN_QUERY) {
      setSubmitted(normalized);
      setEnteredQuery(normalized);
      remember();
    }
  }

  // Close the suggestions on a click outside the field.
  useEffect(() => {
    if (!suggestOpen) return;
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !fieldRef.current?.contains(event.target))
        setSuggestOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [suggestOpen]);

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
          className={`section-search-field${showSuggestions ? " has-suggestions" : ""}`}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (showSuggestions && highlight >= 0) suggestionRows[highlight]?.run();
            else if (topAniList) {
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
            aria-expanded={showSuggestions}
            aria-controls="search-suggestions"
            aria-activedescendant={
              showSuggestions && highlight >= 0 ? `search-suggestion-${highlight}` : undefined
            }
            role="combobox"
            aria-autocomplete="list"
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestOpen(true);
              setHighlight(-1);
              setDidYouMean(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (showSuggestions)
                  setHighlight((at) => Math.min(suggestionRows.length - 1, at + 1));
                else
                  document
                    .querySelector<HTMLElement>(
                      ".section-search-results .more-poster-hit, .section-search-results button",
                    )
                    ?.focus();
              } else if (event.key === "ArrowUp" && showSuggestions) {
                event.preventDefault();
                setHighlight((at) => Math.max(-1, at - 1));
              } else if (event.key === "Escape") {
                if (showSuggestions) {
                  event.preventDefault();
                  setSuggestOpen(false);
                  setHighlight(-1);
                } else if (query) {
                  event.preventDefault();
                  setQuery("");
                }
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
          {showSuggestions ? (
            <div
              className="search-suggestions"
              id="search-suggestions"
              role="listbox"
              aria-label="Suggestions"
            >
              {suggestionRecents.length ? <p className="search-suggestions-head">Recent</p> : null}
              {suggestionRecents.map((entry, index) => (
                <SuggestionRow
                  key={`r${entry}`}
                  index={index}
                  on={highlight === index}
                  label={entry}
                  query={query}
                  meta="Recent"
                  icon={<Clock3 size={16} aria-hidden="true" />}
                  onPick={() => setQuery(entry)}
                />
              ))}
              {suggestionTitles.length ? <p className="search-suggestions-head">Titles</p> : null}
              {suggestionTitles.map((row, at) => {
                const index = suggestionRecents.length + at;
                return (
                  <SuggestionRow
                    key={row.key}
                    index={index}
                    on={highlight === index}
                    label={row.title}
                    query={query}
                    meta={row.meta}
                    image={row.image}
                    onPick={row.open}
                  />
                );
              })}
              {suggestionPeople.length ? (
                <p className="search-suggestions-head">People &amp; studios</p>
              ) : null}
              {suggestionPeople.map((row, at) => {
                const index = suggestionRecents.length + suggestionTitles.length + at;
                return (
                  <SuggestionRow
                    key={`p${row.kind}${row.id}`}
                    index={index}
                    on={highlight === index}
                    label={row.name}
                    query={query}
                    meta={row.kind === "studio" ? "Studio" : `Character · ${row.knownFor ?? ""}`}
                    image={row.imageUrl}
                    icon={<UserRound size={16} aria-hidden="true" />}
                    onPick={() => openPerson(row)}
                  />
                );
              })}
              <SuggestionRow
                index={suggestionRows.length - 1}
                on={highlight === suggestionRows.length - 1}
                label={`See all results for “${query.trim()}”`}
                query=""
                meta="Enter"
                accent
                icon={<Search size={16} aria-hidden="true" />}
                onPick={submitAll}
              />
            </div>
          ) : null}
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
          onClick={() => {
            setSuggestOpen(false);
            setFiltersOpen(true);
          }}
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

      <div className={`section-search-results${pending ? " is-pending" : ""}`}>
        {!showingResults && !person ? (
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
                Keep typing: titles match by whole words. Press Enter to search “{submitted}”
                anyway.
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

function SuggestionRow({
  index,
  on,
  label,
  query,
  meta,
  image,
  icon,
  accent,
  onPick,
}: {
  index: number;
  on: boolean;
  label: string;
  query: string;
  meta: string;
  image?: string;
  icon?: React.ReactNode;
  accent?: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const [before, match, after] = highlightMatch(label, query);
  return (
    <div
      id={`search-suggestion-${index}`}
      role="option"
      aria-selected={on}
      className={`search-suggestion${on ? " is-on" : ""}${accent ? " is-accent" : ""}`}
      // Keep the field focused; pick on pointer down so blur never cancels the choice.
      onPointerDown={(event) => {
        event.preventDefault();
        onPick();
      }}
    >
      {image ? (
        <img src={cachedArtworkUrl(image)} alt="" aria-hidden="true" />
      ) : (
        <span className="search-suggestion-icon">{icon}</span>
      )}
      <span className="search-suggestion-label">
        {before}
        {match ? <strong>{match}</strong> : null}
        {after}
      </span>
      <small>{meta}</small>
    </div>
  );
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

function toAniListResults(page: AniListCatalogPage): Results {
  return {
    kind: "anilist",
    items: page.items,
    page: page.pageInfo.currentPage,
    hasNext: page.pageInfo.hasNextPage,
    extras: page.searchExtras,
  };
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
