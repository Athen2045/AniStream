import { Info, Play, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListCatalogPage,
  AniListDashboard,
  AniListEntry,
  AniListMediaType,
  BrowseAniListInput,
  MangaDexChapterAvailability,
} from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { Pagination } from "./Pagination";
import { safeBackgroundUrl } from "./safe-css-url";

export function CatalogView({
  type,
  searchQuery,
  dashboard,
  onSelect,
  onPrimary,
}: {
  type: AniListMediaType;
  searchQuery: string;
  dashboard?: AniListDashboard;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<BrowseAniListInput["sort"]>("TRENDING_DESC");
  const [catalog, setCatalog] = useState<AniListCatalogPage>();
  const [topRated, setTopRated] = useState<AniListCatalogMedia[]>([]);
  const [interest, setInterest] = useState<AniListCatalogMedia[]>([]);
  const [interestGenre, setInterestGenre] = useState<string>();
  const [mangaAvailability, setMangaAvailability] = useState<
    Map<number, MangaDexChapterAvailability>
  >(new Map());
  const [availabilityNow, setAvailabilityNow] = useState<number>();
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

  const continueCandidates = useMemo(() => {
    const groups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    return (groups ?? [])
      .flatMap((group) => group.entries)
      .filter((entry) => entry.status === "CURRENT" && entry.progress > 0)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 24);
  }, [dashboard, type]);
  const continueEntries = useMemo(
    () =>
      continueCandidates.filter((entry) =>
        shouldShowInContinue(
          entry,
          mangaAvailability.get(entry.media.id)?.latestChapter,
          availabilityNow,
        ),
      ),
    [availabilityNow, continueCandidates, mangaAvailability],
  );
  const libraryMediaIds = useMemo(() => {
    const groups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    return new Set((groups ?? []).flatMap((group) => group.entries.map((entry) => entry.media.id)));
  }, [dashboard, type]);

  useEffect(() => {
    if (!dashboard || searchQuery) return;
    const timer = window.setInterval(() => setAvailabilityNow(Date.now()), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [dashboard, searchQuery]);

  useEffect(() => {
    if (type !== "MANGA" || continueCandidates.length === 0) return;
    let active = true;
    const refreshAvailability = (): void => {
      void window.anistream
        .getMangaDexAvailability(
          continueCandidates.map((entry) => ({
            aniListId: entry.media.id,
            title: entry.media.title,
          })),
        )
        .then((availability) => {
          if (active) {
            setMangaAvailability(new Map(availability.map((item) => [item.aniListId, item])));
          }
        })
        .catch(() => {
          // Availability enrichment is optional; AniList progress remains visible on provider failure.
        });
    };
    refreshAvailability();
    const timer = window.setInterval(refreshAvailability, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [continueCandidates, type]);

  const preferredGenre = useMemo(() => {
    const groups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    const counts = new Map<string, number>();
    for (const entry of (groups ?? []).flatMap((group) => group.entries)) {
      if (entry.status !== "CURRENT" && entry.status !== "COMPLETED" && entry.score < 7) continue;
      for (const genre of entry.media.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  }, [dashboard, type]);

  useEffect(() => {
    if (searchQuery || !dashboard) return;

    let active = true;
    void Promise.allSettled([
      window.anistream.browseAniList({ type, page: 1, perPage: 24, sort: "SCORE_DESC" }),
      preferredGenre
        ? window.anistream.browseAniList({
            type,
            page: 1,
            perPage: 24,
            genre: preferredGenre,
            sort: "POPULARITY_DESC",
          })
        : Promise.resolve(undefined),
    ]).then(([ratedResult, interestResult]) => {
      if (!active) return;
      if (ratedResult.status === "fulfilled") setTopRated(ratedResult.value?.items ?? []);
      if (interestResult.status === "fulfilled" && interestResult.value) {
        setInterest(interestResult.value.items.filter((media) => !libraryMediaIds.has(media.id)));
        setInterestGenre(preferredGenre);
      }
    });
    return () => {
      active = false;
    };
  }, [dashboard, libraryMediaIds, preferredGenre, searchQuery, type]);

  const items = catalog?.items ?? [];
  const hero = items[0];
  const shelf = items.slice(1, 13);
  const grid = items.slice(13);
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
              <button className="play-action" type="button" onClick={() => onPrimary(hero)}>
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
        {!searchQuery && continueEntries.length ? (
          <MediaRail
            title={type === "ANIME" ? "Continue Watching" : "Continue Reading"}
            eyebrow="From your AniList"
            entries={continueEntries}
            onSelect={onSelect}
            onPrimary={onPrimary}
          />
        ) : null}
        {!searchQuery && topRated.length ? (
          <MediaRail
            title="Top Rated"
            eyebrow="Loved by the AniList community"
            items={topRated}
            onSelect={onSelect}
          />
        ) : null}
        {!searchQuery && interest.length ? (
          <MediaRail
            title="Based on Your Interest"
            eyebrow={interestGenre ? `Because you like ${interestGenre}` : "Picked for you"}
            items={interest}
            onSelect={onSelect}
          />
        ) : null}
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
            <div className="rail-heading">
              <div>
                <p className="catalog-kicker">Moving up now</p>
                <h2>Trending {mediaName}</h2>
              </div>
            </div>
            <ContentCarousel label={`Trending ${mediaName}`}>
              {shelf.map((media, index) => (
                <button
                  className="rail-card"
                  type="button"
                  key={media.id}
                  onClick={() => onSelect(media)}
                >
                  <span className="rail-art">
                    <span className="rank">{index + 1}</span>
                    <img src={media.coverUrl} alt="" loading="lazy" />
                  </span>
                  <span className="shelf-copy">
                    <strong>{media.title}</strong>
                    <small>{formatLabel(media.format)}</small>
                  </span>
                </button>
              ))}
            </ContentCarousel>
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

function MediaRail({
  title,
  eyebrow,
  items,
  entries,
  onSelect,
  onPrimary,
}: {
  title: string;
  eyebrow: string;
  items?: AniListCatalogMedia[];
  entries?: AniListEntry[];
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary?: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const cards = items ?? entries?.map(toCatalogMedia) ?? [];
  return (
    <section className="media-rail" aria-label={title}>
      <div className="rail-heading">
        <div>
          <p className="catalog-kicker">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <span className="rail-count">{cards.length} titles</span>
      </div>
      <ContentCarousel label={title}>
        {cards.map((media, index) => {
          const entry = entries?.[index];
          return (
            <button
              type="button"
              className="rail-card"
              key={media.id}
              onClick={() => (entry && onPrimary ? onPrimary(media) : onSelect(media))}
            >
              <span className="rail-art">
                <img src={media.coverUrl} alt="" loading="lazy" />
                <span className="rail-overlay">
                  <span className="round-action">
                    <Play size={16} fill="currentColor" />
                  </span>
                </span>
                {entry ? (
                  <span className="rail-progress" aria-label={`${entry.progress} completed`}>
                    <span style={{ width: `${progressPercent(entry)}%` }} />
                  </span>
                ) : null}
              </span>
              <strong>{media.title}</strong>
              <span>
                {entry
                  ? `${entry.progress}${media.totalProgress ? ` / ${media.totalProgress}` : ""} ${
                      media.type === "ANIME" ? "episodes" : "chapters"
                    }`
                  : media.averageScore
                    ? `${media.averageScore}% match`
                    : formatLabel(media.format)}
              </span>
            </button>
          );
        })}
      </ContentCarousel>
    </section>
  );
}

function toCatalogMedia(entry: AniListEntry): AniListCatalogMedia {
  return {
    ...entry.media,
    genres: entry.media.genres ?? [],
    averageScore: entry.media.averageScore,
  };
}

function progressPercent(entry: AniListEntry): number {
  if (!entry.media.totalProgress) return 18;
  return Math.min(100, Math.round((entry.progress / entry.media.totalProgress) * 100));
}

export function shouldShowInContinue(
  entry: AniListEntry,
  latestMangaChapter?: number,
  now = Date.now(),
): boolean {
  if (entry.status !== "CURRENT" || entry.progress <= 0) return false;

  const total = entry.media.totalProgress;
  if (entry.media.status === "FINISHED" && total && entry.progress >= total) return false;

  const nextAiringEpisode = entry.media.nextAiringEpisode;
  if (
    entry.media.type === "ANIME" &&
    nextAiringEpisode &&
    nextAiringEpisode.airingAt * 1_000 > now &&
    entry.progress >= Math.max(0, nextAiringEpisode.episode - 1)
  ) {
    return false;
  }

  if (entry.media.type === "MANGA") {
    if (latestMangaChapter !== undefined && entry.progress >= latestMangaChapter) return false;
    if (total && entry.progress >= total) return false;
  }
  return true;
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
