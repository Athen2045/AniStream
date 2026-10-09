import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import type { ViewerAccess } from "./viewer-access";
import { ContentCarousel } from "./ContentCarousel";
import { CoverImage } from "./CoverImage";
import { RailHoverActions } from "./RailHoverActions";
import { usePersonalLibrary } from "./PersonalLibraryProvider";
import { AniListSourceIcon } from "./AniListSourceIcon";
import { titleAccentStyle } from "./title-accent";
import { cachedArtworkUrl } from "../../shared/artwork";
import { ContinueRemoveButton } from "./ContinueRemoveButton";

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
    <section
      className={`personal-library media-rail${type === "ANIME" ? " continue-watching" : " continue-reading"}`}
      aria-label={label}
    >
      {state.pending ? (
        <div className="personal-sync" role="status">
          <span>
            {state.pending} change{state.pending === 1 ? "" : "s"} saved locally · AniList sync
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
                {access.kind === "member" ? (
                  <>
                    Local activity
                    <AniListSourceIcon label="AniList source" />
                  </>
                ) : (
                  "Saved on this device"
                )}
              </p>
              <h2>{label}</h2>
            </div>
            <span className="rail-count">
              {continuing.length} title{continuing.length === 1 ? "" : "s"}
            </span>
          </div>
          <ContentCarousel label={label}>
            {continuing.map((item) => {
              const media = { ...item.media, genres: item.media.genres ?? [] };
              const total = item.media.totalProgress;
              const ratio = total ? Math.min(1, item.progress / total) : 0;
              // Anime cards are wide strips cut from the 1900×400 banner (cover when absent);
              // manga cards are books tinted with the title's own cover color.
              const strip = type === "ANIME";
              const art = strip
                ? (item.media.bannerUrl ?? item.media.coverUrl)
                : item.media.coverUrl;
              return (
                <article
                  className={`rail-card continue-card${strip ? " continue-strip" : " continue-book"}`}
                  key={item.media.id}
                  style={strip ? undefined : titleAccentStyle(item.media.coverColor)}
                >
                  <span
                    className={`rail-art${strip && !item.media.bannerUrl ? " continue-strip-cover" : ""}`}
                  >
                    <button
                      type="button"
                      className="rail-art-hit"
                      onClick={() => onPrimary(media, item.targetUnit)}
                      aria-label={`${item.label}: ${item.media.title}`}
                    />
                    <CoverImage src={cachedArtworkUrl(art)} title={item.media.title} />
                    {strip && ratio > 0 ? (
                      <span className="continue-progress" aria-hidden="true">
                        <span style={{ transform: `scaleX(${ratio})` }} />
                      </span>
                    ) : null}
                    <RailHoverActions
                      title={item.media.title}
                      primaryLabel={strip ? "Watch" : "Read"}
                      onPlay={() => onPrimary(media, item.targetUnit)}
                      onInfo={() => onSelect(media)}
                    />
                    <ContinueRemoveButton
                      section={type}
                      id={item.media.id}
                      title={item.media.title}
                    />
                  </span>
                  {!strip ? (
                    <span className="continue-progress continue-progress--book" aria-hidden="true">
                      <span style={{ transform: `scaleX(${ratio})` }} />
                    </span>
                  ) : null}
                  <button
                    className="card-title-button"
                    type="button"
                    title={item.media.title}
                    onClick={() => onSelect(media)}
                  >
                    {item.media.title}
                  </button>
                  <span>
                    {item.label}
                    {total && item.progress > 0 ? ` · ${item.progress}/${total}` : ""}
                  </span>
                </article>
              );
            })}
          </ContentCarousel>
        </>
      ) : null}
    </section>
  );
}
