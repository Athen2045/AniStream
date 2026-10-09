import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { TitleFeedbackRef, TitleFeedbackValue } from "../../shared/contracts";

/**
 * "Interested" / "Not interested" thumbs for a title page. A choice shapes For You in that section
 * (interested titles act like liked ones; not interested ones and their kind sink and never come
 * back as picks); pressing the active thumb again clears it.
 */
export function TitleFeedback({
  title,
  target,
  className,
  iconSize = 18,
}: {
  title: string;
  target: TitleFeedbackRef;
  className: string;
  iconSize?: number;
}): React.JSX.Element {
  const [value, setValue] = useState<TitleFeedbackValue>(null);
  const [error, setError] = useState(false);
  const { type, id } = target;

  useEffect(() => {
    let active = true;
    window.anistream
      .getTitleFeedback({ type, id })
      .then((next) => active && setValue(next))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [type, id]);

  const choose = (next: Exclude<TitleFeedbackValue, null>): void => {
    const updated = value === next ? null : next;
    const previous = value;
    setValue(updated);
    setError(false);
    void window.anistream.setTitleFeedback({ type, id }, updated).catch(() => {
      setValue(previous);
      setError(true);
    });
  };

  return (
    <span className="title-feedback" role="group" aria-label={`Your interest in ${title}`}>
      <button
        type="button"
        className={`${className}${value === "interested" ? " is-active" : ""}`}
        aria-pressed={value === "interested"}
        aria-label={value === "interested" ? "Interested (press to clear)" : "Interested"}
        title={error ? "Could not save. Try again." : "Interested: more like this"}
        onClick={() => choose("interested")}
      >
        <ThumbsUp size={iconSize} fill={value === "interested" ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        className={`${className}${value === "not-interested" ? " is-active" : ""}`}
        aria-pressed={value === "not-interested"}
        aria-label={
          value === "not-interested" ? "Not interested (press to clear)" : "Not interested"
        }
        title={error ? "Could not save. Try again." : "Not interested: fewer like this"}
        onClick={() => choose("not-interested")}
      >
        <ThumbsDown size={iconSize} fill={value === "not-interested" ? "currentColor" : "none"} />
      </button>
    </span>
  );
}
