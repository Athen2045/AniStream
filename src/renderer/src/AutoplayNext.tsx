import { SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BingeEntry } from "../../shared/binge";
import { useOptionalBinge } from "./BingeProvider";
import { bingeItemTitle } from "./binge-session";
import { useAppPreferences } from "./app-preferences";

/** Seconds before autoplay starts what comes next (user decision 2026-10-06). */
export const AUTOPLAY_SECONDS = 5;

export interface NextUp {
  heading: string;
  title: string;
  play: () => void;
}

/**
 * What plays after the current item: the next episode when the parent has one, otherwise the
 * first Up Next entry that is not the title already playing (only while Up Next is on).
 */
export function useNextUp(
  nextEpisode: NextUp | undefined,
  currentKeys: readonly string[],
): NextUp | undefined {
  const binge = useOptionalBinge();
  const { upNext } = useAppPreferences();
  if (nextEpisode) return nextEpisode;
  if (!upNext) return undefined;
  const entry: BingeEntry | undefined = binge?.state.queue.find(
    (candidate) => !currentKeys.includes(candidate.key),
  );
  if (!binge || !entry) return undefined;
  return {
    heading: "Up Next",
    title: bingeItemTitle(entry.item),
    play: () => binge.play(entry, true),
  };
}

/**
 * The end-of-episode prompt. With autoplay on it counts down and then plays; Cancel stops the
 * countdown and leaves the button. With autoplay off it is just the button.
 */
export function AutoplayNext({ next }: { next: NextUp }): React.JSX.Element {
  const binge = useOptionalBinge();
  const autoplay = binge?.autoplay ?? false;
  const [remaining, setRemaining] = useState(AUTOPLAY_SECONDS);
  const [cancelled, setCancelled] = useState(false);
  const counting = autoplay && !cancelled;
  // Player progress re-renders often; keep the latest action without restarting the countdown.
  const play = useRef(next.play);
  useEffect(() => {
    play.current = next.play;
  }, [next.play]);

  useEffect(() => {
    if (!counting) return;
    if (remaining <= 0) {
      play.current();
      return;
    }
    const tick = window.setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => window.clearTimeout(tick);
  }, [counting, remaining]);

  return (
    <div className="next-preview-wrap">
      <button
        className="next-preview"
        type="button"
        onClick={next.play}
        style={
          counting
            ? ({
                "--autoplay-progress": `${(AUTOPLAY_SECONDS - remaining) / AUTOPLAY_SECONDS}`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span>{counting ? `${next.heading} in ${remaining}` : next.heading}</span>
        <strong>{next.title}</strong>
        <SkipForward size={22} />
        {counting ? <i className="next-preview-progress" aria-hidden="true" /> : null}
      </button>
      {counting ? (
        <button
          type="button"
          className="next-preview-cancel"
          aria-label="Cancel autoplay"
          title="Cancel autoplay"
          onClick={() => setCancelled(true)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
