import mangaDexIcon from "./assets/mangadex.svg";

/**
 * Official MangaDex logo, used for the attribution MangaDex's acceptable-usage policy requires.
 * Pass an empty label when adjacent text already names MangaDex.
 */
export function MangaDexSourceIcon({ label = "MangaDex" }: { label?: string }): React.JSX.Element {
  if (!label) {
    return (
      <span className="mangadex-source-icon" aria-hidden="true">
        <img src={mangaDexIcon} alt="" />
      </span>
    );
  }
  return (
    <span className="mangadex-source-icon" role="img" aria-label={label} title={label}>
      <img src={mangaDexIcon} alt="" aria-hidden="true" />
    </span>
  );
}
