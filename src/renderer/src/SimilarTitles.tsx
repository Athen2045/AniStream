import { Star } from "lucide-react";
import { CoverImage } from "./CoverImage";

/** One "More like this" pick, already chosen and ordered by the caller. */
export interface SimilarTitle {
  key: string;
  title: string;
  posterUrl?: string;
  /** e.g. "TV · 148 eps" or "Movie · 1995". */
  meta: string;
  /** AniList "89%" or TMDB "7.4"; TMDB scores show a star. */
  score?: { label: string; star?: boolean };
  onSelect: () => void;
}

/** The best 6 picks in one even row (user decision 2026-10-06), shared by Anime, Manga and More. */
export function SimilarTitles({ items }: { items: SimilarTitle[] }): React.JSX.Element {
  return (
    <div className="similar-grid">
      {items.slice(0, 6).map((item) => (
        <button
          key={item.key}
          type="button"
          className="similar-card"
          aria-label={`Details for ${item.title}`}
          onClick={item.onSelect}
        >
          <span className="similar-art">
            <CoverImage src={item.posterUrl} title={item.title} />
            {item.score ? (
              <span className={`similar-score${item.score.star ? " similar-score--star" : ""}`}>
                {item.score.star ? <Star size={11} fill="currentColor" aria-hidden="true" /> : null}
                {item.score.label}
              </span>
            ) : null}
          </span>
          <strong title={item.title}>{item.title}</strong>
          <small>{item.meta}</small>
        </button>
      ))}
    </div>
  );
}
