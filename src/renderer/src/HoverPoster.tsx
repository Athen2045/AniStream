import { BookOpen, Check, Info, Play, Plus, Star, ThumbsDown } from "lucide-react";
import type { ReactNode } from "react";
import { CoverImage } from "./CoverImage";

/**
 * Poster-only card shared by More and the section search pages. Title, rating, and quick actions
 * live inside the artwork and appear on hover or keyboard focus; the poster itself opens details.
 */
export function HoverPoster({
  title,
  imageUrl,
  score,
  meta,
  rank,
  tag,
  primaryLabel = "Play",
  releaseLabel,
  saved,
  onOpen,
  onPrimary,
  onToggleSaved,
  saveControl,
  caption,
  onDismiss,
}: {
  title: string;
  imageUrl?: string;
  /** Already formatted, e.g. "8.1". */
  score?: string;
  meta: ReadonlyArray<string | number | undefined>;
  rank?: number;
  /** Short format label shown on the artwork, e.g. "Movie". */
  tag?: string;
  primaryLabel?: "Play" | "Read";
  /** Set for unreleased titles: hides Play and shows when the title becomes available. */
  releaseLabel?: string;
  /** Omit to hide the list button (for example a guest without a library). */
  saved?: boolean;
  onOpen: () => void;
  onPrimary: () => void;
  onToggleSaved?: () => void;
  /** Replaces the plain list toggle with a richer control (More's save menu). */
  saveControl?: ReactNode;
  /** Why this title is shown (recommendations), under the rating line. */
  caption?: string;
  /** Recommendation "Not interested" action. */
  onDismiss?: () => void;
}): React.JSX.Element {
  return (
    <article className="more-poster">
      <span className="more-poster-art">
        <CoverImage src={imageUrl} title={title} />
        <button
          className="more-poster-hit"
          type="button"
          aria-label={`Open ${title}`}
          onClick={onOpen}
        />
        {rank ? (
          <span className="more-poster-rank" aria-hidden="true">
            {rank}
          </span>
        ) : tag || releaseLabel ? (
          <span className="more-poster-rank more-poster-tag" aria-hidden="true">
            {releaseLabel ? "Coming soon" : tag}
          </span>
        ) : null}
        <span className="more-poster-info">
          <strong>{title}</strong>
          <span className="more-poster-meta">
            {score ? (
              <span className="more-score">
                <Star size={12} fill="currentColor" aria-hidden="true" />
                {score}
              </span>
            ) : null}
            {meta
              .filter((part) => part !== undefined && part !== "")
              .map((part) => (
                <span key={String(part)}>{part}</span>
              ))}
          </span>
          {releaseLabel ? <span className="more-poster-release">{releaseLabel}</span> : null}
          {caption ? <span className="more-poster-caption">{caption}</span> : null}
          <span className="more-poster-actions">
            {releaseLabel ? null : (
              <button
                type="button"
                className="more-mini more-mini--play"
                aria-label={`${primaryLabel} ${title}`}
                title={primaryLabel}
                onClick={onPrimary}
              >
                {primaryLabel === "Read" ? (
                  <BookOpen size={14} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
              </button>
            )}
            {saveControl ? (
              saveControl
            ) : onToggleSaved && saved !== undefined ? (
              <button
                type="button"
                className="more-mini"
                aria-label={
                  saved ? `Remove ${title} from My Watch List` : `Add ${title} to My Watch List`
                }
                aria-pressed={saved}
                title={saved ? "Remove from My Watch List" : "Add to My Watch List"}
                onClick={onToggleSaved}
              >
                {saved ? <Check size={15} /> : <Plus size={15} />}
              </button>
            ) : null}
            <button
              type="button"
              className="more-mini"
              aria-label={`Details for ${title}`}
              title="Details"
              onClick={onOpen}
            >
              <Info size={15} />
            </button>
            {onDismiss ? (
              <button
                type="button"
                className="more-mini"
                aria-label={`Not interested in ${title}`}
                title="Not interested"
                onClick={onDismiss}
              >
                <ThumbsDown size={14} />
              </button>
            ) : null}
          </span>
        </span>
      </span>
    </article>
  );
}
