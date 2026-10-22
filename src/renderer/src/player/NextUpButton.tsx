import { X } from "lucide-react";
import { PlayerIcon } from "./PlayerIcon";

/**
 * The end-of-episode prompt in the style of "Skip opening" (same pill and place), for every
 * player: its fill sweeps across while the countdown runs, and Cancel stops the countdown.
 * `remaining` is undefined when autoplay is off: then it is just the button.
 */
export function NextUpButton({
  heading,
  title,
  remaining,
  total,
  onPlay,
  onCancel,
}: {
  heading: string;
  title: string;
  remaining?: number;
  total: number;
  onPlay: () => void;
  onCancel?: () => void;
}): React.JSX.Element {
  const counting = remaining !== undefined;
  const progress = counting ? Math.min(1, Math.max(0, (total - remaining) / total)) : 0;
  return (
    <div className="vplayer-next">
      <button
        type="button"
        className="vplayer-skip"
        onClick={onPlay}
        aria-label={`${counting ? `${heading} in ${remaining}` : heading}: ${title}`}
        title={title}
        style={{ "--skip-progress": String(progress) } as React.CSSProperties}
      >
        <span className="vplayer-skip-fill" aria-hidden="true" />
        <PlayerIcon name="next" />
        <span>{heading}</span>
        <small className="vplayer-next-title">{title}</small>
        {counting ? <small aria-hidden="true">{remaining}</small> : null}
      </button>
      {counting && onCancel ? (
        <button
          type="button"
          className="vplayer-skip vplayer-next-cancel"
          aria-label="Cancel autoplay"
          title="Cancel autoplay"
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
