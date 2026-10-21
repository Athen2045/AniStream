import { useEffect, useMemo, useRef, useState } from "react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import { CatalogCard } from "./CatalogCard";
import { ContentCarousel } from "./ContentCarousel";
import { hasHiddenGenre, useHiddenTags } from "./hidden-tags";
import { aniListStarterRows, type AniListStarterRow } from "./starter-rows";

/** The Anime and Manga starter rows (`starter-rows.ts`), shown until For You can take over. */
export function StarterRails({
  type,
  exclude,
  inLibrary,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  type: AniListMediaType;
  /** Titles already on the page (Trending), left out so rows do not repeat them. */
  exclude: ReadonlySet<number>;
  inLibrary: (media: AniListCatalogMedia) => boolean;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
}): React.JSX.Element {
  // Fixed for the visit; the next day's visit picks other genres.
  const [openedAt] = useState(() => Date.now());
  const rows = useMemo(() => aniListStarterRows(type, openedAt), [openedAt, type]);
  return (
    <>
      {rows.map((row) => (
        <StarterRail
          key={`${type}:${row.id}`}
          row={row}
          exclude={exclude}
          inLibrary={inLibrary}
          onSelect={onSelect}
          onPrimary={onPrimary}
          onLibrary={onLibrary}
        />
      ))}
    </>
  );
}

function StarterRail({
  row,
  exclude,
  inLibrary,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  row: AniListStarterRow;
  exclude: ReadonlySet<number>;
  inLibrary: (media: AniListCatalogMedia) => boolean;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
}): React.JSX.Element | null {
  const section = useRef<HTMLElement>(null);
  const [items, setItems] = useState<AniListCatalogMedia[]>();
  const [failed, setFailed] = useState(false);
  const hiddenTags = useHiddenTags();
  useEffect(() => {
    // Loaded only as the row nears the viewport, so opening a section costs no AniList burst.
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        window.anistream
          .browseAniList({ ...row.input, page: 1 })
          .then((page) => {
            if (!cancelled) setItems(page.items);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: "400px" },
    );
    if (section.current) observer.observe(section.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [row]);
  const shown = (items ?? []).filter(
    (media) => !exclude.has(media.id) && !hasHiddenGenre(media.genres, hiddenTags),
  );
  // A row that failed or came back too thin leaves no empty heading behind.
  if (failed || (items && shown.length < 4)) return null;
  return (
    <section ref={section} className="media-rail" aria-label={row.title}>
      <div className="rail-heading">
        <div>
          <p className="catalog-kicker">{row.kicker}</p>
          <h2>{row.title}</h2>
        </div>
      </div>
      {items ? (
        <ContentCarousel label={row.title}>
          {shown.map((media) => (
            <CatalogCard
              key={media.id}
              media={media}
              inLibrary={inLibrary(media)}
              onSelect={onSelect}
              onPrimary={onPrimary}
              onLibrary={onLibrary}
            />
          ))}
        </ContentCarousel>
      ) : (
        <div className="rail-skeleton-row" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span className="rail-card-skeleton" key={index} />
          ))}
        </div>
      )}
    </section>
  );
}
