import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import type { ViewerAccess } from "./viewer-access";
import { ContentCarousel } from "./ContentCarousel";
import { CoverImage } from "./CoverImage";
import { RailHoverActions } from "./RailHoverActions";
import { usePersonalLibrary } from "./PersonalLibraryProvider";

export function PersonalLibrary({
  type,
  access,
  onSelect,
  onPrimary,
}: {
  type: AniListMediaType;
  access: ViewerAccess;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia, targetUnit?: number) => void;
}): React.JSX.Element | null {
  const { session, state } = usePersonalLibrary();
  const continuing = state.continuing[type];
  if (!continuing.length && !state.pending) return null;
  const label = type === "ANIME" ? "Continue Watching" : "Continue Reading";
  return (
    <section className="personal-library media-rail" aria-label={label}>
      {state.pending ? (
        <div className="personal-sync" role="status">
          <span>
            {state.pending} title{state.pending === 1 ? "" : "s"} saved locally · AniList sync
            pending
          </span>
          <button type="button" onClick={() => void session.retrySync()} disabled={state.syncing}>
            {state.syncing ? "Syncing…" : "Retry sync"}
          </button>
        </div>
      ) : null}
      {continuing.length ? (
        <>
          <div className="rail-heading">
            <div>
              <p className="catalog-kicker">
                {access.kind === "member" ? "Local activity & AniList" : "Saved on this device"}
              </p>
              <h2>{label}</h2>
            </div>
            <span className="rail-count">
              {continuing.length} title{continuing.length === 1 ? "" : "s"}
            </span>
          </div>
          <ContentCarousel label={label}>
            {continuing.map((item) => (
              <article className="rail-card continue-card" key={item.media.id}>
                <span className="rail-art">
                  <button
                    type="button"
                    className="rail-art-hit"
                    onClick={() => onPrimary(item.media, item.targetUnit)}
                    aria-label={`${item.label}: ${item.media.title}`}
                  />
                  <CoverImage src={item.media.coverUrl} title={item.media.title} />
                  <RailHoverActions
                    title={item.media.title}
                    primaryLabel={type === "ANIME" ? "Watch" : "Read"}
                    onPlay={() => onPrimary(item.media, item.targetUnit)}
                    onInfo={() => onSelect(item.media)}
                  />
                </span>
                <button
                  className="card-title-button"
                  type="button"
                  title={item.media.title}
                  onClick={() => onSelect(item.media)}
                >
                  {item.media.title}
                </button>
                <span>{item.label}</span>
              </article>
            ))}
          </ContentCarousel>
        </>
      ) : null}
    </section>
  );
}
