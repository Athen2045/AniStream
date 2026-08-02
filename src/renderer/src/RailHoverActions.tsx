import { Info, Play, Plus, X } from "lucide-react";

/**
 * Netflix-style hover row: play, add-to-list, remove-from-list, and info. Rendered as
 * siblings of the card's own hit-target button (never nested inside it — buttons
 * cannot legally nest), positioned above it with a higher stacking order so each
 * control receives its own click instead of falling through to the card underneath.
 */
export function RailHoverActions({
  title,
  library,
  onPlay,
  onInfo,
}: {
  title: string;
  library?: {
    inLibrary: boolean;
    onAdd: () => void;
    onRemove: () => void;
  };
  onPlay: () => void;
  onInfo: () => void;
}): React.JSX.Element {
  return (
    <span className="rail-hover-actions">
      <button
        type="button"
        className="rail-hover-play"
        aria-label={`Play ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
      >
        <Play size={15} fill="currentColor" />
      </button>
      {library ? (
        <>
          <button
            type="button"
            className="rail-hover-secondary"
            aria-label={
              library.inLibrary ? `${title} is already in your list` : `Add ${title} to your list`
            }
            disabled={library.inLibrary}
            onClick={(event) => {
              event.stopPropagation();
              library.onAdd();
            }}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="rail-hover-secondary"
            aria-label={
              library.inLibrary ? `Remove ${title} from your list` : `${title} is not in your list`
            }
            disabled={!library.inLibrary}
            onClick={(event) => {
              event.stopPropagation();
              library.onRemove();
            }}
          >
            <X size={14} />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="rail-hover-secondary rail-hover-info"
        aria-label={`More info for ${title}`}
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
