import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";
import { formatMediaLabel } from "./format-label";
import { motionTransition } from "./motion";
import { combinedSearch } from "./combined-search";
import { useAppReducedMotion } from "./useAppReducedMotion";

export function GlobalSearch({
  onSelect,
  onSubmit,
}: {
  onSelect: (media: AniListCatalogMedia) => void;
  onSubmit: (query: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AniListCatalogMedia[]>([]);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const reducedMotion = useAppReducedMotion();

  useEffect(() => {
    const normalized = query.trim();
    // A too-short query never renders the results popover (see the JSX below), so
    // there is nothing to reset here -- avoid calling setState synchronously in the
    // effect body for a branch with no observable effect.
    if (normalized.length < 2) {
      requestId.current += 1;
      return;
    }

    const currentRequest = ++requestId.current;
    const timer = window.setTimeout(() => {
      void combinedSearch(normalized, window.anistream)
        .then(({ items, failedTypes }) => {
          if (currentRequest !== requestId.current) return;
          setResults(items);
          setError(
            failedTypes.length
              ? `${failedTypes.map((type) => (type === "ANIME" ? "Anime" : "Manga")).join(" and ")} search is unavailable. ${items.length ? "Available results are shown below." : "Try searching again."}`
              : undefined,
          );
          setActiveIndex(-1);
        })
        .finally(() => {
          if (currentRequest === requestId.current) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [query]);

  function choose(media: AniListCatalogMedia): void {
    requestId.current += 1;
    setFocused(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setError(undefined);
    setLoading(false);
    onSelect(media);
  }

  return (
    <div className="global-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length < 2) return;
          if (!loading && activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex]);
          else if (query.trim().length >= 2) {
            onSubmit(query.trim());
            setFocused(false);
          }
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            requestId.current += 1;
            setResults([]);
            setError(undefined);
            setActiveIndex(-1);
            setQuery(nextQuery);
            setLoading(nextQuery.trim().length >= 2);
          }}
          onFocus={() => {
            clearTimeout(blurTimer.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setFocused(false), 160);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFocused(false);
              return;
            }
            if (!results.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
            }
          }}
          placeholder="Search anime and manga"
          aria-label="Search anime and manga"
          role="combobox"
          aria-expanded={focused && query.trim().length >= 2}
          aria-controls="global-search-results"
          aria-activedescendant={
            activeIndex >= 0 && results[activeIndex]
              ? `search-result-${results[activeIndex].type}-${results[activeIndex].id}`
              : undefined
          }
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              requestId.current += 1;
              setQuery("");
              setResults([]);
              setActiveIndex(-1);
              setLoading(false);
              inputRef.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        ) : (
          <kbd>
            {typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
              ? "Ctrl+K"
              : "⌘K"}
          </kbd>
        )}
      </form>

      <AnimatePresence>
        {focused && query.trim().length >= 2 ? (
          <motion.div
            className="search-popover"
            id="search-suggestions"
            role="region"
            aria-label="Search results"
            initial={reducedMotion ? false : { opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={motionTransition(reducedMotion, "fast")}
          >
            <div className="search-popover-label">
              <span>{loading ? "Searching AniList…" : "Search results"}</span>
              <span>Anime + manga</span>
            </div>
            {error ? <p role="status">{error}</p> : null}
            {loading && !results.length
              ? Array.from({ length: 3 }, (_, index) => (
                  <span
                    className="search-result-skeleton"
                    aria-hidden="true"
                    key={`search-skeleton-${index}`}
                  />
                ))
              : null}
            <div role="listbox" id="global-search-results" aria-label="Suggested titles">
              {results.map((media, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  id={`search-result-${media.type}-${media.id}`}
                  className={index === activeIndex ? "active" : ""}
                  key={`${media.type}-${media.id}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(media)}
                >
                  <img src={media.coverUrl} alt="" loading="lazy" decoding="async" />
                  <span>
                    <strong>{media.title}</strong>
                    <small>
                      {media.type === "ANIME" ? "Anime" : "Manga"} · {formatLabel(media.format)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <button
              className="search-view-all"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSubmit(query.trim());
                setFocused(false);
              }}
            >
              View all results for “{query.trim()}”
            </button>
            {!loading && !results.length && !error ? (
              <p>No matching titles. Press Enter to browse the full catalog.</p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function formatLabel(value?: string): string {
  return formatMediaLabel(value);
}
