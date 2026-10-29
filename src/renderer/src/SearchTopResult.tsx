import { Info, Play, Plus } from "lucide-react";
import { cachedArtworkUrl } from "../../shared/artwork";
import { CoverImage } from "./CoverImage";
import { titleTintStyle } from "./title-accent";

/** The confident first match, shown large above the other results with Watch/Read and Details. */
export function SearchTopResult({
  image,
  cover,
  tint,
  kicker,
  title,
  meta,
  progress,
  description,
  primaryLabel,
  onPrimary,
  onDetails,
  onAdd,
}: {
  image?: string;
  cover?: string;
  tint?: string;
  kicker: string;
  title: string;
  meta: ReadonlyArray<string | number | undefined>;
  progress?: string;
  description?: string;
  primaryLabel: string;
  onPrimary: () => void;
  onDetails: () => void;
  onAdd?: () => void;
}): React.JSX.Element {
  return (
    <article className="section-search-top" style={titleTintStyle(tint)}>
      {image ? (
        <img
          className="section-search-top-art"
          src={cachedArtworkUrl(image)}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      <div className="section-search-top-body">
        {cover ? (
          <CoverImage
            src={cachedArtworkUrl(cover)}
            title={title}
            className="section-search-top-cover"
          />
        ) : null}
        <div>
          <span className="section-search-kicker">{kicker}</span>
          <h2>{title}</h2>
          <p className="section-search-top-meta">
            {meta.filter((part) => part !== undefined && part !== "").join(" · ")}
            {progress ? <span className="is-progress"> · {progress}</span> : null}
          </p>
          {description ? <p className="section-search-top-desc">{description}</p> : null}
          <div className="section-search-top-actions">
            <button type="button" className="title-primary" onClick={onPrimary}>
              <Play size={18} fill="currentColor" aria-hidden="true" />
              {primaryLabel}
            </button>
            <button type="button" className="title-library" onClick={onDetails}>
              <Info size={18} aria-hidden="true" />
              Details
            </button>
            {onAdd ? (
              <button
                type="button"
                className="title-library title-round"
                aria-label="Add to list"
                onClick={onAdd}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
