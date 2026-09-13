import { useEffect, useState, useSyncExternalStore } from "react";
import { Search, X } from "lucide-react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import {
  createSearchSession,
  type SearchFilters,
  type SearchType,
  type SearchSort,
} from "./search-session";
import { CatalogCard } from "./CatalogCard";
import { Pagination } from "./Pagination";
import type { ViewerAccess } from "./viewer-access";

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
  const [session] = useState(() => createSearchSession(window.anistream));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [draft, setDraft] = useState(query ?? "");
  const [genre, setGenre] = useState("");
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    if (query !== undefined)
      void session.search({
        query,
        type: restrictedType ?? "ALL",
        genre: "",
        sort: "POPULARITY_DESC",
      });
  }, [query, restrictedType, session]);
  const apply = (patch: Partial<SearchFilters>) => {
    void session.search({ ...state.filters, ...patch });
  };
  const types: AniListMediaType[] =
    state.filters.type === "ALL" ? ["ANIME", "MANGA"] : [state.filters.type];
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
            type: restrictedType ?? state.filters.type,
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
        <select
          aria-label="Sort search results"
          value={state.filters.sort}
          onChange={(event) => apply({ sort: event.target.value as SearchSort })}
        >
          <option value="POPULARITY_DESC">Popularity</option>
          <option value="TRENDING_DESC">Trending</option>
          <option value="SCORE_DESC">Highest score</option>
          <option value="START_DATE_DESC">Release date</option>
        </select>
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
              aria-pressed={state.filters.type === type}
              onClick={() => apply({ type })}
            >
              {type === "ALL" ? "All" : type === "ANIME" ? "Anime" : "Manga"}
            </button>
          ))}
        </div>
      ) : null}
      {state.filters.query.length < 2 ? (
        <p className="empty-state">Enter at least two characters to find a title.</p>
      ) : (
        types.map((type) => {
          const group = state.groups[type];
          return (
            <section
              key={type}
              className="search-result-group"
              aria-label={`${type === "ANIME" ? "Anime" : "Manga"} results`}
            >
              <div className="rail-heading">
                <h2>{type === "ANIME" ? "Anime" : "Manga"}</h2>
                <span className="rail-count">
                  {group.loading ? "Searching…" : `Results for “${state.filters.query}”`}
                </span>
              </div>
              {group.error ? (
                <div className="error-banner" role="alert">
                  {group.error}{" "}
                  <button type="button" onClick={() => void session.retry(type)}>
                    Retry {type === "ANIME" ? "Anime" : "Manga"}
                  </button>
                </div>
              ) : null}
              <div className="search-result-grid" aria-busy={group.loading}>
                {group.result?.items.map((media) => (
                  <CatalogCard
                    key={media.id}
                    media={media}
                    inLibrary={access.kind === "member" && access.libraryEntries.has(media.id)}
                    onSelect={onSelect}
                    onPrimary={onPrimary}
                    onLibrary={onLibrary}
                  />
                ))}
                {group.loading && !group.result
                  ? Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className="rail-card-skeleton" aria-hidden="true" />
                    ))
                  : null}
              </div>
              {!group.loading && !group.error && group.result?.items.length === 0 ? (
                <p className="empty-state">
                  No matching {type === "ANIME" ? "anime" : "manga"}. Try a different title or clear
                  the genre.
                </p>
              ) : null}
              {group.result ? (
                <div className={group.loading ? "pagination-pending" : ""}>
                  <Pagination
                    label={`${type} search pages`}
                    page={group.page}
                    totalPages={group.result.pageInfo.lastPage}
                    hasNextPage={group.result.pageInfo.hasNextPage}
                    onPageChange={(page) => void session.page(type, page)}
                  />
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </section>
  );
}
