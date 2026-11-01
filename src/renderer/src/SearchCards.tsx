import type { AniListCatalogMedia, MoreCatalogItem } from "../../shared/contracts";
import { formatMediaLabel } from "./format-label";
import { HoverPoster } from "./HoverPoster";
import { formatScore, releaseState } from "./more-format";

/**
 * An Anime or Manga poster in Search's grid. `detailed` cards (results) add the score to the line
 * under the title; Trending suggestions leave it out.
 */
export function AniListSearchCard({
  media,
  scope,
  index,
  detailed = false,
  saved,
  onToggleSaved,
  onOpen,
  onPrimary,
}: {
  media: AniListCatalogMedia;
  scope: "ANIME" | "MANGA";
  index: number;
  detailed?: boolean;
  saved?: boolean;
  onToggleSaved?: () => void;
  onOpen: () => void;
  onPrimary: () => void;
}): React.JSX.Element {
  const format = formatMediaLabel(media.format, scope === "ANIME" ? "Anime" : "Manga");
  return (
    <div className="search-card" data-search-card={index}>
      <HoverPoster
        title={media.title}
        imageUrl={media.coverUrl}
        score={media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined}
        meta={[media.seasonYear, format]}
        tag={formatTag(media.format)}
        primaryLabel={scope === "MANGA" ? "Read" : "Play"}
        saved={saved}
        onOpen={onOpen}
        onPrimary={onPrimary}
        onToggleSaved={onToggleSaved}
      />
      <b title={media.title}>{media.title}</b>
      <small>
        {[
          format,
          media.seasonYear,
          detailed && media.averageScore ? `${media.averageScore}%` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </div>
  );
}

/**
 * A movie or show poster in Search's grid. `detailed` cards (results) show the release state and
 * score; Trending suggestions leave them out.
 */
export function MoreSearchCard({
  item,
  index,
  detailed = false,
  saved,
  onToggleSaved,
  onOpen,
  onPrimary,
}: {
  item: MoreCatalogItem;
  index: number;
  detailed?: boolean;
  saved?: boolean;
  onToggleSaved?: () => void;
  onOpen: () => void;
  onPrimary: () => void;
}): React.JSX.Element {
  const kind = item.type === "MOVIE" ? "Movie" : "Series";
  return (
    <div className="search-card" data-search-card={index}>
      <HoverPoster
        title={item.title}
        imageUrl={item.posterUrl}
        score={formatScore(item.score)}
        meta={[item.year, kind]}
        releaseLabel={detailed ? releaseState(item.releaseDate).label : undefined}
        saved={saved}
        onOpen={onOpen}
        onPrimary={onPrimary}
        onToggleSaved={onToggleSaved}
      />
      <b title={item.title}>{item.title}</b>
      <small>
        {[kind, item.year, detailed ? formatScore(item.score) : undefined]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </div>
  );
}

function formatTag(format: string | undefined): string | undefined {
  switch (format) {
    case "MOVIE":
      return "Movie";
    case "SPECIAL":
      return "Special";
    case "OVA":
    case "ONA":
      return format;
    case "ONE_SHOT":
      return "One shot";
    case "NOVEL":
      return "Novel";
    default:
      return undefined;
  }
}
