import { Clock3 } from "lucide-react";

/** Shown instead of Play for titles that are not out yet. */
export function ReleasePill({
  label,
  heading = "Not released yet",
}: {
  label?: string;
  heading?: string;
}): React.JSX.Element {
  return (
    <span className="more-release-pill" role="status">
      <Clock3 size={17} aria-hidden="true" />
      <strong>{heading}</strong>
      {label ? (
        <>
          <span className="more-release-dot" aria-hidden="true" />
          <span>{label}</span>
        </>
      ) : null}
    </span>
  );
}
