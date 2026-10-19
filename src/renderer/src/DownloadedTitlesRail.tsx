import { cachedArtworkUrl } from "../../shared/artwork";
import type { AniListCatalogMedia } from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { CoverImage } from "./CoverImage";
import { useOptionalDownloads } from "./DownloadsProvider";

/**
 * Offline Anime home (user decision 2026-10-18): only the hero and this row of titles with
 * downloaded episodes, the things that can play without a connection. Opening one shows its
 * saved title page, where the downloaded episodes play.
 */
export function DownloadedTitlesRail({
  onSelect,
}: {
  onSelect: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const downloads = useOptionalDownloads();
  const titles = new Map<number, { media: AniListCatalogMedia; episodes: number }>();
  for (const item of downloads?.state?.items ?? []) {
    if (item.status !== "done") continue;
    const entry = titles.get(item.aniListId) ?? {
      media: {
        id: item.aniListId,
        type: "ANIME",
        title: item.title,
        coverUrl: item.coverUrl ?? "",
        genres: [],
        siteUrl: `https://anilist.co/anime/${item.aniListId}`,
      },
      episodes: 0,
    };
    entry.episodes += 1;
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
          {rows.map(({ media, episodes }) => (
            <article className="rail-card" key={media.id}>
              <span className="rail-art">
                <button
                  type="button"
                  className="rail-art-hit"
                  onClick={() => onSelect(media)}
                  aria-label={`${media.title}, ${episodes} downloaded`}
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
                {episodes} {episodes === 1 ? "episode" : "episodes"} downloaded
              </span>
            </article>
          ))}
        </ContentCarousel>
      ) : (
        <p className="downloaded-titles-empty">
          Nothing is downloaded yet. Downloaded episodes play here without a connection.
        </p>
      )}
    </section>
  );
}
