import aniListLogo from "./assets/anilist.svg";
import imdbLogo from "./assets/imdb.svg";
import mangaUpdatesLogo from "./assets/mangaupdates.svg";
import malLogo from "./assets/myanimelist.svg";
import simklLogo from "./assets/simkl.svg";
import tmdbLogo from "./assets/tmdb.svg";

export type RatingSource = "anilist" | "mal" | "mangaupdates" | "tmdb" | "imdb" | "simkl";

const LOGOS: Record<RatingSource, { src: string; name: string }> = {
  anilist: { src: aniListLogo, name: "AniList" },
  mal: { src: malLogo, name: "MyAnimeList" },
  mangaupdates: { src: mangaUpdatesLogo, name: "MangaUpdates" },
  tmdb: { src: tmdbLogo, name: "TMDB" },
  imdb: { src: imdbLogo, name: "IMDb" },
  simkl: { src: simklLogo, name: "Simkl" },
};

export function sourceName(source: RatingSource): string {
  return LOGOS[source].name;
}

/** A data source's own logo, used to credit scores and library data. Decorative by default. */
export function SourceLogo({
  source,
  label,
}: {
  source: RatingSource;
  /** Accessible name; omit when adjacent text already names the source. */
  label?: string;
}): React.JSX.Element {
  return (
    <span
      className={`source-logo source-logo--${source}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
    >
      <img src={LOGOS[source].src} alt="" />
    </span>
  );
}
