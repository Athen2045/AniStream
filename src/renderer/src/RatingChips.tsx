import { Star } from "lucide-react";
import { SourceLogo, sourceName, type RatingSource } from "./SourceLogo";

export interface RatingChip {
  source: RatingSource | "you";
  score: string;
  /** Short line after the score: votes, or the source name. */
  detail?: string;
  /** The title on that source's site. */
  href?: string;
  title?: string;
}

/** "Ratings from": each score credited with its source's logo (user decision 2026-10-06). */
export function RatingChips({
  chips,
}: {
  chips: Array<RatingChip | undefined | false>;
}): React.JSX.Element | null {
  const shown = chips.filter((chip): chip is RatingChip => Boolean(chip));
  if (!shown.length) return null;
  return (
    <div className="rating-chips" aria-label="Ratings">
      {shown.map((chip) => {
        const name = chip.source === "you" ? "Your rating" : sourceName(chip.source);
        const content = (
          <>
            {chip.source === "you" ? (
              <Star size={15} fill="currentColor" aria-hidden="true" />
            ) : (
              <SourceLogo source={chip.source} />
            )}
            <b>{chip.score}</b>
            {chip.detail ? <small>{chip.detail}</small> : null}
          </>
        );
        const label = chip.title ?? `${chip.score} on ${name}`;
        return chip.href ? (
          <a
            key={chip.source}
            className={`rating-chip rating-chip--${chip.source}`}
            href={chip.href}
            target="_blank"
            rel="noreferrer"
            title={label}
            aria-label={label}
          >
            {content}
          </a>
        ) : (
          <span
            key={chip.source}
            className={`rating-chip rating-chip--${chip.source}`}
            title={label}
            aria-label={label}
            role="img"
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}

/** 2_617_000 → "2.6M"; 41_200 → "41k". */
export function compactVotes(votes: number): string {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}k`;
  return String(votes);
}
