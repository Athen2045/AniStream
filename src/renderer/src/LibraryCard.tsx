import { Pencil, Star } from "lucide-react";
import type { AniListEntry, AniListMedia } from "../../shared/contracts";
import { formatMediaLabel } from "./format-label";
import { CoverImage } from "./CoverImage";
import { titleAccentStyle } from "./title-accent";
import { statusLabel } from "./profile-library";

type OpenMedia = (media: AniListMedia, action: "details" | "play" | "read") => void;

function progressParts(entry: AniListEntry) {
  const total = entry.media.totalProgress;
  return {
    total,
    ratio: total ? Math.min(1, entry.progress / total) : undefined,
    unit: entry.media.type === "ANIME" ? "ep" : "ch",
    // Manga progress takes the title's cover color; anime keeps the brand green.
    style: entry.media.type === "MANGA" ? titleAccentStyle(entry.media.coverColor) : undefined,
  };
}

/** Grid card: the cover opens details; hovering or focusing reveals the single Edit action. */
export function LibraryCard({
  entry,
  onEdit,
  onOpenMedia,
}: {
  entry: AniListEntry;
  onEdit: (entry: AniListEntry) => void;
  onOpenMedia: OpenMedia;
}) {
  const { total, ratio, unit, style } = progressParts(entry);
  return (
    <article
      className={`library-card${entry.media.type === "MANGA" ? " library-card--manga" : ""}`}
      style={style}
    >
      <div className="library-card-art">
        <button
          className="library-card-cover"
          type="button"
          aria-label={`Details for ${entry.media.title}`}
          onClick={() => onOpenMedia(entry.media, "details")}
        >
          <CoverImage src={entry.media.coverUrl} title={entry.media.title} />
        </button>
        {entry.score ? (
          <span className="library-score" aria-label={`Your score ${entry.score} out of 10`}>
            <Star size={11} fill="currentColor" aria-hidden="true" />
            <b>{entry.score}</b>
          </span>
        ) : null}
        <button
          className="library-card-edit"
          type="button"
          aria-label={`Edit ${entry.media.title}`}
          onClick={() => onEdit(entry)}
        >
          <Pencil size={14} aria-hidden="true" />
          Edit entry
        </button>
      </div>
      <span className="library-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${ratio ?? (entry.progress ? 1 : 0)})` }} />
      </span>
      <button
        className="library-card-title"
        type="button"
        title={entry.media.title}
        onClick={() => onOpenMedia(entry.media, "details")}
      >
        {entry.media.title}
      </button>
      <p className="library-card-meta">
        <span>
          {entry.progress}
          {total ? `/${total}` : ""} {unit} · {formatMediaLabel(entry.media.format)}
        </span>
        <span>{updatedAgo(entry.updatedAt)}</span>
      </p>
    </article>
  );
}

/** List-view row with the same actions as the card. */
export function LibraryRow({
  entry,
  onEdit,
  onOpenMedia,
}: {
  entry: AniListEntry;
  onEdit: (entry: AniListEntry) => void;
  onOpenMedia: OpenMedia;
}) {
  const { total, ratio, style } = progressParts(entry);
  const anime = entry.media.type === "ANIME";
  return (
    <div className={`library-row${anime ? "" : " library-row--manga"}`} role="row" style={style}>
      <button
        className="library-row-thumb"
        type="button"
        role="cell"
        aria-label={`Details for ${entry.media.title}`}
        onClick={() => onOpenMedia(entry.media, "details")}
      >
        <img src={entry.media.coverUrl} alt="" loading="lazy" />
      </button>
      <span className="library-row-title" role="cell">
        <button type="button" onClick={() => onOpenMedia(entry.media, "details")}>
          {entry.media.title}
        </button>
        <small>
          <em>{formatMediaLabel(entry.media.format)}</em>
          {(entry.media.genres ?? []).slice(0, 2).join(" · ")}
        </small>
      </span>
      <span className="library-row-progress" role="cell">
        {anime ? "Ep." : "Ch."} {entry.progress}
        {total ? ` / ${total}` : " · ongoing"}
        {ratio !== undefined ? (
          <span className="library-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${ratio})` }} />
          </span>
        ) : null}
      </span>
      <span className="library-row-score" role="cell">
        {entry.score ? (
          <>
            <Star size={13} fill="currentColor" aria-hidden="true" />
            <b>{entry.score}</b>
          </>
        ) : (
          <span className="library-row-muted">—</span>
        )}
      </span>
      <span role="cell">
        <span className={`library-status library-status--${entry.status.toLowerCase()}`}>
          {statusLabel(entry.status, anime)}
        </span>
      </span>
      <span className="library-row-muted" role="cell">
        {updatedAgo(entry.updatedAt)}
      </span>
      <span role="cell">
        <button
          className="library-row-edit"
          type="button"
          aria-label={`Edit ${entry.media.title}`}
          title="Edit entry"
          onClick={() => onEdit(entry)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function updatedAgo(seconds: number): string {
  const days = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 86_400));
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}
