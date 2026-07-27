import { Info, Play, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListMediaType,
  BrowseAniListInput,
} from "../../shared/contracts";
import { Pagination } from "./Pagination";
import { safeBackgroundUrl } from "./safe-css-url";

export function CatalogView({
  type,
  searchQuery,
  onSelect,
}: {
  type: AniListMediaType;
  searchQuery: string;
  onSelect: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<BrowseAniListInput["sort"]>("TRENDING_DESC");
  const [catalog, setCatalog] = useState<AniListCatalogPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Reset to page 1 whenever the browse identity changes. Adjusting state directly
  // during render (rather than in an effect) avoids an extra committed render pass --
  // see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [resetKey, setResetKey] = useState({ type, searchQuery, sort });
  if (resetKey.type !== type || resetKey.searchQuery !== searchQuery || resetKey.sort !== sort) {
    setResetKey({ type, searchQuery, sort });
    setPage(1);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void window.anistream
      .browseAniList({
        type,
        page,
        perPage: 24,
        query: searchQuery || undefined,
        sort,
      })
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "AniList browse failed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, searchQuery, sort, type]);

  const items = catalog?.items ?? [];
  const hero = items[0];
  const shelf = items.slice(1, 7);
  const grid = items.slice(7);
  const mediaName = type === "ANIME" ? "anime" : "manga";

  return (
    <section className={`catalog-page ${type === "MANGA" ? "manga-catalog" : "anime-catalog"}`}>
      {hero ? (
        <header
          className="catalog-hero"
          style={{
            backgroundImage: `linear-gradient(90deg, #141414 5%, rgba(20,20,20,.88) 42%, rgba(20,20,20,.18) 76%), linear-gradient(0deg, #141414 0%, transparent 45%), ${safeBackgroundUrl(hero.bannerUrl ?? hero.coverUrl)}`,
          }}
        >
          <div className="catalog-hero-copy">
            <p className="catalog-kicker">
              {searchQuery
                ? `Results for “${searchQuery}”`
                : type === "ANIME"
                  ? "Now trending"
                  : "Featured reading"}
            </p>
            <h1>{hero.title}</h1>
            <div className="catalog-facts">
              {hero.averageScore ? <span className="match">{hero.averageScore}% score</span> : null}
              {hero.seasonYear ? <span>{hero.seasonYear}</span> : null}
              <span>{formatLabel(hero.format)}</span>
              {hero.totalProgress ? (
                <span>
                  {hero.totalProgress} {type === "ANIME" ? "episodes" : "chapters"}
                </span>
              ) : null}
            </div>
            <p>
              {cleanDescription(hero.description) ||
                `Discover ${hero.title} and keep your progress synced with AniList.`}
            </p>
            <div className="hero-actions">
              <button className="play-action" type="button" onClick={() => onSelect(hero)}>
                {type === "ANIME" ? <Play size={20} fill="currentColor" /> : <Search size={20} />}
                {type === "ANIME" ? "Watch" : "Read"}
              </button>
              <button className="info-action" type="button" onClick={() => onSelect(hero)}>
                <Info size={20} />
                More info
              </button>
            </div>
          </div>
        </header>
      ) : null}

      <div className="catalog-content">
        <div className="catalog-toolbar">
          <div>
            <p className="catalog-kicker">{searchQuery ? "Search" : "Discover"}</p>
            <h2>{searchQuery ? `${mediaName} results` : `Browse ${mediaName}`}</h2>
          </div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BrowseAniListInput["sort"])}
            aria-label="Sort catalog"
          >
            <option value="TRENDING_DESC">Trending</option>
            <option value="POPULARITY_DESC">Most popular</option>
            <option value="SCORE_DESC">Highest rated</option>
            <option value="START_DATE_DESC">Newest</option>
          </select>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
        {loading && !catalog ? (
          <div className="catalog-loading">Loading AniList catalog…</div>
        ) : null}

        {shelf.length ? (
          <section className="media-shelf" aria-label={`Trending ${mediaName}`}>
            {shelf.map((media, index) => (
              <button type="button" key={media.id} onClick={() => onSelect(media)}>
                <span className="rank">{index + 1}</span>
                <img src={media.coverUrl} alt="" loading="lazy" />
                <span className="shelf-copy">
                  <strong>{media.title}</strong>
                  <small>{formatLabel(media.format)}</small>
                </span>
              </button>
            ))}
          </section>
        ) : null}

        <div className="browse-grid">
          {(grid.length ? grid : items).map((media) => (
            <button
              type="button"
              className="browse-card"
              key={media.id}
              onClick={() => onSelect(media)}
            >
              <span className="browse-art">
                <img src={media.coverUrl} alt="" loading="lazy" />
                <span className="browse-hover">
                  <span className="round-action">
                    <Play size={16} fill="currentColor" />
                  </span>
                  <span className="round-action">
                    <Plus size={16} />
                  </span>
                </span>
              </span>
              <strong>{media.title}</strong>
              <span>
                {media.averageScore ? <em>{media.averageScore}%</em> : null}
                {media.seasonYear ? ` ${media.seasonYear}` : ""}
                {media.genres[0] ? ` · ${media.genres[0]}` : ""}
              </span>
            </button>
          ))}
        </div>

        {catalog ? (
          <Pagination
            page={page}
            totalPages={catalog.pageInfo.lastPage}
            hasNextPage={catalog.pageInfo.hasNextPage}
            onPageChange={(nextPage) => {
              setPage(nextPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function formatLabel(value?: string): string {
  return value?.replaceAll("_", " ").toLocaleLowerCase() ?? "media";
}

function cleanDescription(value?: string): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/~!/g, "")
    .replace(/!~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
