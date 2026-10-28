import { cachedArtworkUrl } from "../../shared/artwork";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { CoverImage } from "./CoverImage";
import { useOptionalDownloads } from "./DownloadsProvider";

/**
 * Offline Anime and Manga homes (user decisions 2026-10-18, 2026-10-28): only the hero and this
 * row of titles with downloaded episodes or chapters, the things that work without a connection.
 * Opening one shows its saved title page, where the downloaded episodes play and chapters read.
 */
export function DownloadedTitlesRail({
  type,
  onSelect,
}: {
  type: AniListMediaType;
  onSelect: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const downloads = useOptionalDownloads();
  const anime = type === "ANIME";
  const unit = anime ? "episode" : "chapter";
  const titles = new Map<number, { media: AniListCatalogMedia; count: number }>();
  const done = anime ? (downloads?.state?.items ?? []) : (downloads?.state?.chapters ?? []);
  for (const item of done) {
    if (item.status !== "done") continue;
    const entry = titles.get(item.aniListId) ?? {
      media: {
        id: item.aniListId,
        type,
        title: item.title,
        coverUrl: item.coverUrl ?? "",
        genres: [],
        siteUrl: `https://anilist.co/${anime ? "anime" : "manga"}/${item.aniListId}`,
      },
      count: 0,
    };
    entry.count += 1;
    titles.set(item.aniListId, entry);
  }
  const rows = [...titles.values()];
  return (
    <section className="media-rail downloaded-titles" aria-label="Downloaded">
      <div className="rail-heading">
        <div>
          <p className="catalog-kicker">You&rsquo;re offline</p>
          <h2>Downloaded</h2>
        </div>
      </div>
      {rows.length ? (
        <ContentCarousel label="Downloaded">
          {rows.map(({ media, count }) => (
            <article className="rail-card" key={media.id}>
              <span className="rail-art">
                <button
                  type="button"
                  className="rail-art-hit"
                  onClick={() => onSelect(media)}
                  aria-label={`${media.title}, ${count} downloaded`}
                />
                <CoverImage src={cachedArtworkUrl(media.coverUrl)} title={media.title} />
              </span>
              <button
                className="card-title-button"
                type="button"
                title={media.title}
                onClick={() => onSelect(media)}
              >
                {media.title}
              </button>
              <span>
                {count} {count === 1 ? unit : `${unit}s`} downloaded
              </span>
            </article>
          ))}
        </ContentCarousel>
      ) : (
        <p className="downloaded-titles-empty">
          {anime
            ? "Nothing is downloaded yet. Downloaded episodes play here without a connection."
            : "Nothing is downloaded yet. Downloaded chapters read here without a connection."}
        </p>
      )}
    </section>
  );
}
