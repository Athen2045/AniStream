import type { AniListCatalogMedia } from "../../shared/contracts";
import { cachedArtworkUrl } from "../../shared/artwork";
import { CoverImage } from "./CoverImage";

/**
 * While the title page's code loads (rare once it is prefetched): what the card already knew --
 * banner, cover and title -- with the rest shaped as placeholders, instead of a spinner.
 */
export function TitlePageFallback({ media }: { media: AniListCatalogMedia }): React.JSX.Element {
  return (
    <div className="title-fallback" role="status" aria-label={`Loading ${media.title}`}>
      <div className="title-fallback-band" aria-hidden="true">
        {media.bannerUrl ? <img src={cachedArtworkUrl(media.bannerUrl)} alt="" /> : null}
      </div>
      <div className="title-fallback-main" aria-hidden="true">
        <div className="title-fallback-cover">
          <CoverImage src={media.coverUrl} title={media.title} />
        </div>
        <div className="title-fallback-copy">
          <strong>{media.title}</strong>
          <div className="title-fallback-pills">
            <span className="sk-pill" />
            <span className="sk-pill" />
            <span className="sk-pill" />
          </div>
          <span className="sk-line" style={{ width: "92%" }} />
          <span className="sk-line" style={{ width: "86%" }} />
          <span className="sk-line" style={{ width: "58%" }} />
        </div>
      </div>
    </div>
  );
}
