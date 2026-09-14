import aniListIcon from "./assets/anilist.svg";

export function AniListSourceIcon({ label = "AniList" }: { label?: string }): React.JSX.Element {
  return (
    <span className="anilist-source-icon" role="img" aria-label={label} title={label}>
      <img src={aniListIcon} alt="" aria-hidden="true" />
    </span>
  );
}
