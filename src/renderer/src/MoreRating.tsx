import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { MoreCatalogItem, MoreTitleRating } from "../../shared/contracts";
import { moreSnapshot } from "./more-format";

const SCALE = Array.from({ length: 10 }, (_, index) => index + 1);
const WORDS = [
  "",
  "Awful",
  "Very bad",
  "Bad",
  "Poor",
  "Average",
  "Fine",
  "Good",
  "Very good",
  "Great",
  "Masterpiece",
];

/**
 * The viewer's own 1–10 rating for a More title; kept here and sent to Simkl when connected.
 * Rating unlocks once the title is completed. `completed` is the page's view of that, so marking
 * it Completed with "+" unlocks the stars without leaving the page.
 */
export function MoreRating({
  item,
  completed,
}: {
  item: MoreCatalogItem;
  completed: boolean;
}): React.JSX.Element {
  const [state, setState] = useState<MoreTitleRating>();
  const [preview, setPreview] = useState<number>();
  const [note, setNote] = useState<string>();

  useEffect(() => {
    let active = true;
    window.anistream
      .getMoreRating({ type: item.type, tmdbId: item.id })
      .then((next) => active && setState(next))
      .catch(() => active && setState({ syncsToSimkl: false, canRate: false }));
    return () => {
      active = false;
    };
  }, [item.id, item.type, completed]);

  const rate = (rating: number | undefined): void => {
    setState((current) => ({ syncsToSimkl: false, canRate: true, ...current, rating }));
    setNote(undefined);
    void window.anistream
      .setMoreRating(moreSnapshot(item), rating ?? null)
      .then((result) => {
        if (result.simkl === "failed") setNote(result.message);
        else if (result.simkl === "synced")
          setNote(rating ? "Saved to Simkl." : "Removed on Simkl.");
      })
      .catch((reason: unknown) =>
        setNote(
          reason instanceof Error && /before rating/.test(reason.message)
            ? "Finish watching this title, or mark it Completed with +, to rate it."
            : "Your rating could not be saved. Try again.",
        ),
      );
  };

  const rating = state?.rating;
  const locked = !state || !(state.canRate || completed);
  const shown = (locked ? undefined : preview) ?? rating;
  return (
    <div className={`more-rating${locked ? " is-locked" : ""}`} aria-busy={!state}>
      <span className="more-rating-label">Your rating</span>
      <div
        className="more-rating-stars"
        role="radiogroup"
        aria-label={`Rate ${item.title} from 1 to 10`}
        onMouseLeave={() => setPreview(undefined)}
      >
        {SCALE.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} out of 10, ${WORDS[value]}`}
            title={`${value} · ${WORDS[value]}`}
            className={shown !== undefined && value <= shown ? "is-on" : undefined}
            disabled={locked}
            onMouseEnter={() => setPreview(value)}
            onFocus={() => setPreview(value)}
            onBlur={() => setPreview(undefined)}
            onClick={() => rate(value === rating ? undefined : value)}
          >
            <Star size={18} fill="currentColor" aria-hidden="true" />
          </button>
        ))}
      </div>
      <span className="more-rating-value" aria-live="polite">
        {shown
          ? `${shown}/10 · ${WORDS[shown]}`
          : locked && state
            ? "Rate after you finish it"
            : "Not rated"}
      </span>
      {rating && !preview && !locked ? (
        <button type="button" className="more-rating-clear" onClick={() => rate(undefined)}>
          Clear
        </button>
      ) : null}
      {state?.simklUrl && rating ? (
        <a className="more-rating-link" href={state.simklUrl} target="_blank" rel="noreferrer">
          Simkl
        </a>
      ) : null}
      {note ? <span className="more-rating-note">{note}</span> : null}
    </div>
  );
}
