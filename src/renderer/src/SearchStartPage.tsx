import { Clock3, X } from "lucide-react";
import { cachedArtworkUrl } from "../../shared/artwork";
import { clearRecentSearches, removeRecentSearch } from "./recent-searches";
import { GENRE_TILES } from "./search-genres";
import type { SearchScope } from "./search-queries";

/** Search before typing: recent searches, genre tiles, then what is trending (`children`). */
export function SearchStartPage({
  scope,
  recent,
  rememberSearches,
  genreArt,
  onSearch,
  onPickGenre,
  children,
}: {
  scope: SearchScope;
  recent: readonly string[];
  /** Recent searches are kept on the device (else for this session only). */
  rememberSearches: boolean;
  genreArt: ReadonlyMap<string, string>;
  onSearch: (query: string) => void;
  onPickGenre: (genre: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
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
                <button type="button" onClick={() => onSearch(entry)}>
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
                onClick={() => onPickGenre(tile.genre)}
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
        <div className="section-search-grid">{children}</div>
      </section>
    </>
  );
}
