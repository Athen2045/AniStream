import { Search } from "lucide-react";

/**
 * A finished search with nothing to show, and the ways on from it: the likely title for a typo,
 * fewer filters, Movies & TV, or the other section when it has matches.
 */
export function SearchNoMatches({
  query,
  noun,
  filtered,
  didYouMean,
  otherSection,
  onSearch,
  onClearFilters,
  onSearchMore,
  onOtherSection,
}: {
  /** The search that found nothing ("" when only filters are set). */
  query: string;
  noun: string;
  filtered: boolean;
  didYouMean?: string;
  /** The other Anime/Manga section's matches for the same search. */
  otherSection?: { label: string; count: number };
  onSearch: (query: string) => void;
  onClearFilters: () => void;
  /** Present for an Anime/Manga search: search Movies & TV instead. */
  onSearchMore?: () => void;
  onOtherSection: () => void;
}): React.JSX.Element {
  return (
    <section className="section-search-none">
      <h2>{query ? `No matches for “${query}”` : "No titles match these filters"}</h2>
      <p>
        {filtered
          ? "The filters may be too narrow. Remove one, or clear them all."
          : `Nothing in ${noun} by that name. Check the spelling, or try fewer words.`}
      </p>
      <div className="section-search-none-actions">
        {didYouMean ? (
          <button type="button" className="is-primary" onClick={() => onSearch(didYouMean)}>
            <Search size={17} aria-hidden="true" />
            Search “{didYouMean}” instead
          </button>
        ) : null}
        {filtered ? (
          <button type="button" onClick={onClearFilters}>
            Remove filters
          </button>
        ) : null}
        {onSearchMore ? (
          <button type="button" onClick={onSearchMore}>
            Search Movies &amp; TV
          </button>
        ) : null}
        {otherSection ? (
          <button type="button" onClick={onOtherSection}>
            Show {otherSection.count} in {otherSection.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}
