import { Clock3, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  MoreCatalogItem,
  MoreCatalogPage,
  MoreMediaType,
} from "../../shared/contracts";
import {
  moreFilterCount,
  moreTypesFor,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import { DEFAULT_MORE_SORT, MoreFilterBar, emptyMoreFilters } from "./MoreFilterBar";
import type { AniListFilterOptions } from "../../shared/anilist-filters";
import { CatalogFilterBar } from "./CatalogFilterBar";
import {
  DEFAULT_SORT,
  activeFilterCount,
  browseInput,
  emptyFilters,
  filterKey,
  type CatalogFilterState,
} from "./catalog-filters";
import { HoverPoster } from "./HoverPoster";
import { formatMediaLabel } from "./format-label";
import { formatScore, moreKey, moreSnapshot, releaseState } from "./more-format";
import { friendlyRemoteError } from "./remote-error";
import type { ViewerAccess } from "./viewer-access";

export type SearchScope = "ANIME" | "MANGA" | "MORE";

const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;
const PAGE_SIZE = 30;
const TRENDING_SIZE = 18;
const RECENT_LIMIT = 6;

/** Recent searches stay in memory for this app session only; nothing is persisted. */
const recentByScope: Record<SearchScope, string[]> = { ANIME: [], MANGA: [], MORE: [] };
/** The query in each section's field, so returning from a title shows the same search. */
const queryByScope: Record<SearchScope, string> = { ANIME: "", MANGA: "", MORE: "" };
/** Filters are remembered per section for this app session, like recent searches. */
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

function rememberSearch(scope: SearchScope, query: string): void {
  const normalized = query.trim();
  if (normalized.length < MIN_QUERY) return;
  const list = recentByScope[scope].filter(
    (entry) => entry.toLocaleLowerCase() !== normalized.toLocaleLowerCase(),
  );
  recentByScope[scope] = [normalized, ...list].slice(0, RECENT_LIMIT);
}

const COPY: Record<SearchScope, { heading: string; placeholder: string; noun: string }> = {
  ANIME: { heading: "What are you watching next?", placeholder: "Search anime…", noun: "anime" },
  MANGA: {
    heading: "Find your next read",
    placeholder: "Search manga, manhwa & manhua…",
    noun: "manga",
  },
  MORE: {
    heading: "Find a movie or show",
    placeholder: "Search movies & TV shows…",
    noun: "movies and shows",
  },
};

type Results =
  | { kind: "anilist"; items: AniListCatalogMedia[]; page: number; hasNext: boolean }
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

/**
 * Full-page search for one section. Anime, Manga, and More never mix results. Typing searches
 * after a short pause; an empty field shows recent searches and what is trending in the section.
 */
export function SectionSearch({
  scope,
  access,
  onOpenMedia,
  onPrimaryMedia,
  onLibrary,
  onOpenMore,
  onPrimaryMore,
}: {
  scope: SearchScope;
  access: ViewerAccess;
  onOpenMedia: (media: AniListCatalogMedia) => void;
  onPrimaryMedia: (media: AniListCatalogMedia) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
  onOpenMore: (item: MoreCatalogItem) => void;
  onPrimaryMore: (item: MoreCatalogItem) => void;
}): React.JSX.Element {
  const copy = COPY[scope];
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQueryState] = useState(() => queryByScope[scope]);
  const setQuery = (next: string): void => {
    queryByScope[scope] = next;
    setQueryState(next);
  };
  const [submitted, setSubmitted] = useState(() =>
    queryByScope[scope].trim().length >= MIN_QUERY ? queryByScope[scope].trim() : "",
  );
  const [results, setResults] = useState<{ key: string; data?: Results; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [trending, setTrending] = useState<Results>();
  const [recent, setRecent] = useState(() => recentByScope[scope]);
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
  // Filters (or a non-default sort) browse the catalog even with an empty search field.
  const browsing = catalogScope ? filterCount > 0 || filters.sort !== DEFAULT_SORT : moreFiltered;
  const searchKey =
    submitted || browsing
      ? `${submitted}|${catalogScope ? filterKey(filters) : JSON.stringify(moreFilters)}`
      : "";

  const updateFilters = (next: CatalogFilterState): void => {
    if (catalogScope) filtersByScope[catalogScope] = next;
    setFilters(next);
  };
  const updateMoreFilters = (next: MoreBrowseFilters): void => {
    moreFiltersState = next;
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
    const current = results.data;
    setLoadingMore(true);
    try {
      const next = await window.anistream.browseAniList(
        browseInput(scope, current.page + 1, PAGE_SIZE, submitted, filters),
      );
      setResults((state) =>
        state?.key === results.key && state.data?.kind === "anilist"
          ? {
              ...state,
              data: {
                kind: "anilist",
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

  const remember = (): void => {
    rememberSearch(scope, query);
    setRecent(recentByScope[scope]);
  };

  const toggleMore = (item: MoreCatalogItem): void => {
    const saved = !savedMore.has(moreKey(item));
    setSavedMore((current) => {
      const next = new Set(current);
      if (saved) next.add(moreKey(item));
      else next.delete(moreKey(item));
      return next;
    });
    void window.anistream.setMoreWatchlist(moreSnapshot(item), saved).catch(() => undefined);
  };

  const showingResults = Boolean(searchKey);
  const current = showingResults && results?.key === searchKey ? results : undefined;
  const pending = showingResults && !current;
  const grid = showingResults ? current?.data : trending;
  const count = current?.data?.items.length ?? 0;
  const hasMore =
    grid?.kind === "anilist" ? grid.hasNext : Boolean(grid?.next && Object.keys(grid.next).length);

  const renderPosters = (): React.ReactNode => {
    if (!grid) return null;
    if (grid.kind === "more")
      return grid.items.map((item) => (
        <HoverPoster
          key={moreKey(item)}
          title={item.title}
          imageUrl={item.posterUrl}
          score={formatScore(item.score)}
          meta={[item.year, item.type === "MOVIE" ? "Movie" : "Series"]}
          releaseLabel={releaseState(item.releaseDate).label}
          saved={savedMore.has(moreKey(item))}
          onOpen={() => {
            remember();
            onOpenMore(item);
          }}
          onPrimary={() => {
            remember();
            onPrimaryMore(item);
          }}
          onToggleSaved={() => toggleMore(item)}
        />
      ));
    const member = access.kind === "member";
    return grid.items.map((media) => (
      <HoverPoster
        key={media.id}
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
    ));
  };

  return (
    <section className="section-search" aria-label={`Search ${copy.noun}`}>
      <div className="section-search-ambience" aria-hidden="true">
        <span className="ambience-blob ambience-blob--1" />
        <span className="ambience-blob ambience-blob--2" />
        <span className="ambience-blob ambience-blob--3" />
        <span className="ambience-blob ambience-blob--4" />
      </div>
      <div className="section-search-hero">
        <h1>{copy.heading}</h1>
        <form
          className="section-search-field"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = query.trim();
            if (normalized.length >= MIN_QUERY) {
              setSubmitted(normalized);
              remember();
            }
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
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          ) : null}
        </form>
        <p className="section-search-hint">
          Searching {scope === "MORE" ? "movies & shows" : copy.noun} only · <kbd>Ctrl</kbd>
          <kbd>K</kbd> to search
        </p>
        {catalogScope ? (
          <CatalogFilterBar
            type={catalogScope}
            value={filters}
            options={filterOptions}
            onChange={updateFilters}
          />
        ) : (
          <MoreFilterBar value={moreFilters} onChange={updateMoreFilters} />
        )}
        {!submitted && recent.length ? (
          <div className="section-search-recent" aria-label="Recent searches">
            {recent.map((entry) => (
              <button key={entry} type="button" onClick={() => setQuery(entry)}>
                <Clock3 size={14} aria-hidden="true" />
                {entry}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="section-search-body">
        {showingResults ? (
          <div className="section-search-head">
            <div>
              <h2>{submitted ? <>Results for “{submitted}”</> : `Browse ${copy.noun}`}</h2>
            </div>
            <span role="status">
              {pending
                ? "Searching…"
                : current?.error
                  ? ""
                  : `${count}${hasMore ? "+" : ""} ${copy.noun}`}
            </span>
          </div>
        ) : (
          <h2 className="section-search-trending">Trending {copy.noun} today</h2>
        )}
        {current?.error ? <p className="error-banner">{current.error}</p> : null}
        {showingResults && current?.data && !count ? (
          <p className="section-search-empty">
            {submitted
              ? filterCount
                ? `Nothing matched “${submitted}” with these filters. Try removing one.`
                : `Nothing matched “${submitted}”. Try a shorter or different title.`
              : "No titles match these filters. Try removing one."}
          </p>
        ) : null}
        <div className={`section-search-grid${pending ? " is-pending" : ""}`}>
          {renderPosters()}
        </div>
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
    </section>
  );
}

function toAniListResults(page: AniListCatalogPage): Results {
  return {
    kind: "anilist",
    items: page.items,
    page: page.pageInfo.currentPage,
    hasNext: page.pageInfo.hasNextPage,
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
