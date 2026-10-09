import malIcon from "./assets/myanimelist.svg";

/**
 * MyAnimeList logo for crediting data AniStream shows from MAL. The brand-blue mark sits on a
 * white chip so it stays legible on the dark theme. Pass an empty label when adjacent text
 * already names MyAnimeList.
 */
export function MalSourceIcon({ label = "MyAnimeList" }: { label?: string }): React.JSX.Element {
  if (!label) {
    return (
      <span className="mal-source-icon" aria-hidden="true">
        <img src={malIcon} alt="" />
      </span>
    );
  }
  return (
    <span className="mal-source-icon" role="img" aria-label={label} title={label}>
      <img src={malIcon} alt="" aria-hidden="true" />
    </span>
  );
}
