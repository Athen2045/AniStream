import { Star } from "lucide-react";
import { MalSourceIcon } from "./MalSourceIcon";
import { joinWords } from "./title-facts";

/** The open Rate panel: an AniList rating out of 10, Save rating, and Mark completed. */
export function TitleTracker({
  value,
  saving,
  onChange,
  onSave,
  onComplete,
}: {
  value: number;
  saving: boolean;
  onChange: (value: number) => void;
  onSave: () => void;
  onComplete: () => void;
}): React.JSX.Element {
  return (
    <div className="detail-tracker-compact title-tracker">
      <label>
        <Star size={15} />
        <span className="sr-only">AniList rating out of 10</span>
        <input
          aria-label="AniList rating out of 10"
          type="number"
          min="0"
          max="10"
          step="0.5"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>/ 10</span>
      </label>
      <button type="button" disabled={saving} onClick={onSave}>
        Save rating
      </button>
      <button type="button" disabled={saving} onClick={onComplete}>
        Mark completed
      </button>
    </div>
  );
}

/** The Rate toggle beside the title's actions; the star fills once the viewer has rated it. */
export function RateButton({
  open,
  rated,
  onToggle,
}: {
  open: boolean;
  rated: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      className="title-round"
      type="button"
      aria-label="Rate or complete"
      aria-expanded={open}
      title="Rate or mark completed"
      onClick={onToggle}
    >
      <Star size={18} fill={rated ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}

/** Credits MyAnimeList for what it filled in ("Summary and genres from MyAnimeList"). */
export function MalFillCredit({ parts, url }: { parts: string[]; url: string }): React.JSX.Element {
  return (
    <p className="title-source-credit">
      <MalSourceIcon label="" />
      <span>
        {joinWords(parts)} from{" "}
        <a href={url} target="_blank" rel="noreferrer">
          MyAnimeList
        </a>
      </span>
    </p>
  );
}
