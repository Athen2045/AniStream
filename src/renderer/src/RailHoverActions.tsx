import { BookOpen, Info, Play, Plus, Check } from "lucide-react";

/**
 * Netflix-style hover row: play, add-to-list, remove-from-list, and info. Rendered as
 * siblings of the card's own hit-target button (never nested inside it — buttons
 * cannot legally nest), positioned above it with a higher stacking order so each
 * control receives its own click instead of falling through to the card underneath.
 */
export function RailHoverActions({
  title,
  primaryLabel = "Watch",
  library,
  onPlay,
  onInfo,
}: {
  title: string;
  primaryLabel?: "Play" | "Watch" | "Read";
  library?: {
    inLibrary: boolean;
    busy?: boolean;
    onManage: () => void;
  };
  onPlay: () => void;
  onInfo: () => void;
}): React.JSX.Element {
  return (
    <span className="rail-hover-actions">
      <button
        type="button"
        className="rail-hover-play"
        aria-label={`${primaryLabel} ${title}`}
        title={`${primaryLabel} ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
      >
        {primaryLabel === "Read" ? <BookOpen size={15} /> : <Play size={15} fill="currentColor" />}
      </button>
      {library ? (
        <button
          type="button"
          className="rail-hover-secondary"
          title={library.inLibrary ? "Edit library entry" : "Add to Planning"}
          aria-label={
            library.inLibrary ? `Edit ${title} in your library` : `Add ${title} to your list`
          }
          disabled={library.busy}
          onClick={(event) => {
            event.stopPropagation();
            library.onManage();
          }}
        >
          {library.inLibrary ? <Check size={16} /> : <Plus size={16} />}
        </button>
      ) : null}
      <button
        type="button"
        className="rail-hover-secondary rail-hover-info"
        aria-label={`More info for ${title}`}
        title="Title details"
        onClick={(event) => {
          event.stopPropagation();
          onInfo();
        }}
      >
        <Info size={14} />
      </button>
    </span>
  );
}
