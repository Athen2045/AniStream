import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, X } from "lucide-react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import { friendlyRemoteError } from "./remote-error";
import {
  profileSearchQuery,
  type ProfileSearchFilters as SearchFilters,
  type ProfileSearchSort as SearchSort,
  type ProfileSearchType as SearchType,
} from "./search-queries";
import { CatalogCard } from "./CatalogCard";
import { Pagination } from "./Pagination";
import type { ViewerAccess } from "./viewer-access";
import { Select } from "./Select";

export function SearchView({
  query,
  restrictedType,
  access,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  query?: string;
  restrictedType?: AniListMediaType;
  access: ViewerAccess;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(query ?? "");
  const [genre, setGenre] = useState("");
  const initialFilters = (): SearchFilters => ({
    query: query?.trim() ?? "",
    type: restrictedType ?? "ALL",
    genre: "",
    sort: "POPULARITY_DESC",
  });
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  // A new search starts each section on page 1.
  const [pages, setPages] = useState<Record<AniListMediaType, number>>({ ANIME: 1, MANGA: 1 });
  // A new `query` from the caller starts that search.
  const [shownQuery, setShownQuery] = useState(query);
  if (query !== shownQuery) {
    setShownQuery(query);
    if (query !== undefined) {
      setFilters(initialFilters());
      setPages({ ANIME: 1, MANGA: 1 });
    }
  }
  const apply = (patch: Partial<SearchFilters>) => {
    const next = { ...filters, ...patch };
    setFilters({ ...next, query: next.query.trim(), genre: next.genre.trim() });
    setPages({ ANIME: 1, MANGA: 1 });
  };
  const types: AniListMediaType[] = filters.type === "ALL" ? ["ANIME", "MANGA"] : [filters.type];
  return (
    <section
      className={`search-page${restrictedType ? " search-page-inline" : ""}`}
      aria-label={restrictedType ? "Add title search" : "Search anime and manga"}
    >
      <header className="search-heading">
        <p className="catalog-kicker">
          {restrictedType ? "Add to your library" : "Discover something new"}
        </p>
        <h1>
          {restrictedType ? `Find ${restrictedType === "ANIME" ? "anime" : "manga"}` : "Search"}
        </h1>
      </header>
      <form
        className="search-filters"
        onSubmit={(event) => {
          event.preventDefault();
          apply({
            query: String(new FormData(event.currentTarget).get("query") ?? ""),
            genre,
            type: restrictedType ?? filters.type,
          });
        }}
      >
        <label className="search-query-field">
          <Search size={18} />
          <span className="sr-only">Title search</span>
          <input
            name="query"
            key={query}
            defaultValue={query ?? draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search by title"
            minLength={2}
            maxLength={200}
          />
        </label>
        <label className="search-genre-field">
          <span className="sr-only">Genre</span>
          <input
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
            placeholder="Genre, e.g. Action"
            minLength={2}
            maxLength={80}
          />
          {genre ? (
            <button
              type="button"
              title="Clear genre"
              aria-label="Clear genre"
              onClick={() => {
                setGenre("");
                apply({ genre: "" });
              }}
            >
              <X size={15} />
            </button>
          ) : null}
        </label>
        <Select<SearchSort>
          ariaLabel="Sort search results"
          value={filters.sort}
          onChange={(sort) => apply({ sort })}
          options={[
            { value: "POPULARITY_DESC", label: "Popularity" },
            { value: "TRENDING_DESC", label: "Trending" },
            { value: "SCORE_DESC", label: "Highest score" },
            { value: "START_DATE_DESC", label: "Release date" },
          ]}
        />
        <button className="primary-button" type="submit">
          Search
        </button>
      </form>
      {!restrictedType ? (
        <div className="search-type-tabs" aria-label="Search media type">
          {(["ALL", "ANIME", "MANGA"] as SearchType[]).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={filters.type === type}
              onClick={() => apply({ type })}
            >
              {type === "ALL" ? "All" : type === "ANIME" ? "Anime" : "Manga"}
            </button>
          ))}
        </div>
      ) : null}
      {filters.query.length < 2 ? (
        <p className="empty-state">Enter at least two characters to find a title.</p>
      ) : (
        types.map((type) => (
          <SearchResultGroup
            key={type}
            type={type}
            filters={filters}
            page={pages[type]}
            onPage={(page) => setPages((current) => ({ ...current, [type]: page }))}
            access={access}
            onSelect={onSelect}
            onPrimary={onPrimary}
            onLibrary={onLibrary}
          />
        ))
      )}
    </section>
  );
}

/** One section's results, page by page (`profileSearchQuery`). */
function SearchResultGroup({
  type,
  filters,
  page,
  onPage,
  access,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  type: AniListMediaType;
  filters: SearchFilters;
  page: number;
  onPage: (page: number) => void;
  access: ViewerAccess;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
  onLibrary: (media: AniListCatalogMedia) => Promise<void>;
}): React.JSX.Element {
  const search = useQuery(profileSearchQuery(type, filters, page));
  const result = search.data;
  const loading = search.isFetching;
  const error =
    search.error && !loading
      ? friendlyRemoteError(search.error, {
          provider: "AniList",
          operation: "search results",
          retained: Boolean(result?.items.length),
          fallback: "Search is unavailable right now. Try again shortly.",
        })
      : undefined;
  const name = type === "ANIME" ? "Anime" : "Manga";
  return (
    <section className="search-result-group" aria-label={`${name} results`}>
      <div className="rail-heading">
        <h2>{name}</h2>
        <span className="rail-count">
          {loading ? "Searching…" : `Results for “${filters.query}”`}
        </span>
      </div>
      {error ? (
        <div className="error-banner" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void search.refetch()}>
            Retry {name}
          </button>
        </div>
      ) : null}
      <div className="search-result-grid" aria-busy={loading}>
        {result?.items.map((media) => (
          <CatalogCard
            key={media.id}
            media={media}
            inLibrary={access.kind === "member" && access.libraryEntries.has(media.id)}
            onSelect={onSelect}
            onPrimary={onPrimary}
            onLibrary={onLibrary}
          />
        ))}
        {loading && !result
          ? Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="rail-card-skeleton" aria-hidden="true" />
            ))
          : null}
      </div>
      {!loading && !error && result?.items.length === 0 ? (
        <p className="empty-state">
          No matching {type === "ANIME" ? "anime" : "manga"}. Try a different title or clear the
          genre.
        </p>
      ) : null}
      {result ? (
        <div className={loading ? "pagination-pending" : ""}>
          <Pagination
            label={`${type} search pages`}
            page={page}
            totalPages={result.pageInfo.lastPage}
            hasNextPage={result.pageInfo.hasNextPage}
            onPageChange={onPage}
          />
        </div>
      ) : null}
    </section>
  );
}
