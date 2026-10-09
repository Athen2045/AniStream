import { useState } from "react";
import type { AniListCatalogMedia } from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { RailHoverActions } from "./RailHoverActions";
import { formatMediaLabel } from "./format-label";
import { friendlyRemoteError } from "./remote-error";
import { titleAccentStyle } from "./title-accent";

export function CatalogCard({
  media,
  inLibrary,
  rank,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  media: AniListCatalogMedia;
  inLibrary: boolean;
  rank?: number;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <article
      className="rail-card catalog-result-card"
      style={media.type === "MANGA" ? titleAccentStyle(media.coverColor) : undefined}
    >
      <span className="rail-art">
        <button
          className="rail-art-hit"
          type="button"
          aria-label={`Details for ${media.title}`}
          onClick={() => onSelect(media)}
        />
        <CoverImage src={media.coverUrl} title={media.title} />
        {rank ? (
          <span className="rank" aria-label={`Rank ${rank}`}>
            {rank}
          </span>
        ) : null}
        <RailHoverActions
          title={media.title}
          meta={[
            formatMediaLabel(media.format),
            media.totalProgress
              ? `${media.totalProgress} ${media.type === "ANIME" ? "eps" : "ch"}`
              : undefined,
            media.averageScore ? `${media.averageScore}%` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
          primaryLabel={media.type === "ANIME" ? "Watch" : "Read"}
          onPlay={() => onPrimary(media)}
          onInfo={() => onSelect(media)}
          library={
            onLibrary
              ? {
                  inLibrary,
                  busy,
                  onManage: () => {
                    setBusy(true);
                    setError(undefined);
                    void onLibrary(media)
                      .catch((reason: unknown) =>
                        setError(
                          friendlyRemoteError(reason, {
                            provider: "AniList",
                            operation: "library changes",
                            fallback: "Your library could not be updated. Try again.",
                          }),
                        ),
                      )
                      .finally(() => setBusy(false));
                  },
                }
              : undefined
          }
        />
      </span>
      <button
        className="card-title-button"
        type="button"
        onClick={() => onSelect(media)}
        title={media.title}
      >
        {media.title}
      </button>
      <span className="card-metadata">
        {formatMediaLabel(media.format)}
        {media.seasonYear ? ` · ${media.seasonYear}` : ""}
        {media.averageScore ? ` · ${media.averageScore}%` : ""}
      </span>
      {error ? (
        <p className="card-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
