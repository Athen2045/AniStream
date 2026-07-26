import { Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";

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
  const requestId = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void Promise.all([
        window.anistream.browseAniList({ type: "ANIME", page: 1, perPage: 4, query: normalized }),
        window.anistream.browseAniList({ type: "MANGA", page: 1, perPage: 4, query: normalized }),
      ])
        .then(([anime, manga]) => {
          if (currentRequest !== requestId.current) return;
          setResults([...anime.items, ...manga.items]);
          setActiveIndex(-1);
        })
        .finally(() => {
          if (currentRequest === requestId.current) setLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  function choose(media: AniListCatalogMedia): void {
    setFocused(false);
    setQuery("");
    onSelect(media);
  }

  return (
    <div className="global-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (activeIndex >= 0 && results[activeIndex]) choose(results[activeIndex]);
          else if (query.trim().length >= 2) {
            onSubmit(query.trim());
            setFocused(false);
          }
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 160)}
          onKeyDown={(event) => {
            if (!results.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
            } else if (event.key === "Escape") {
              setFocused(false);
            }
          }}
          placeholder="Search anime and manga"
          aria-label="Search anime and manga"
          role="combobox"
          aria-expanded={focused && query.trim().length >= 2}
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
            <X size={15} />
          </button>
        ) : (
          <kbd>⌘K</kbd>
        )}
      </form>

      <AnimatePresence>
        {focused && query.trim().length >= 2 ? (
          <motion.div
            className="search-popover"
            initial={reducedMotion ? false : { opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
          >
            <div className="search-popover-label">
              <span>{loading ? "Searching AniList…" : "Search results"}</span>
              <span>Anime + manga</span>
            </div>
            {results.map((media, index) => (
              <button
                type="button"
                className={index === activeIndex ? "active" : ""}
                key={`${media.type}-${media.id}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(media)}
              >
                <img src={media.coverUrl} alt="" />
                <span>
                  <strong>{media.title}</strong>
                  <small>{media.type === "ANIME" ? "Anime" : "Manga"} · {formatLabel(media.format)}</small>
                </span>
              </button>
            ))}
            {!loading && !results.length ? (
              <p>No matching titles. Press Enter to browse the full catalog.</p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function formatLabel(value?: string): string {
  return value?.replaceAll("_", " ").toLocaleLowerCase() ?? "media";
}
