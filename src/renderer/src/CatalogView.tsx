import { BookOpen, ExternalLink, Info, Play, Plus } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaType,
  LatestMangaUpdate,
} from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { Pagination } from "./Pagination";
import { RailHoverActions } from "./RailHoverActions";
import { safeBackgroundUrl } from "./safe-css-url";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { useCatalogData } from "./useCatalogData";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";

export function CatalogView({
  type,
  searchQuery,
  access,
  onSelect,
  onPrimary,
}: {
  type: AniListMediaType;
  searchQuery: string;
  access: ViewerAccess;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia) => void;
}): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const personalized = hasPersonalizedAccess(access);
  const dashboard = personalized ? access.dashboard : undefined;
  const continueCandidates = useMemo(() => {
    const groups = type === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
    return (groups ?? [])
      .flatMap((group) => group.entries)
      .filter((entry) => entry.status === "CURRENT" && entry.progress > 0)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 24);
  }, [dashboard, type]);
  const availabilityMedia = useMemo(
    () =>
      continueCandidates.map((entry) => ({
        aniListId: entry.media.id,
        title: entry.media.title,
      })),
    [continueCandidates],
  );
  const {
    page,
    latestPage,
    searchResults,
    trending,
    malTrendingFallback,
    trendingLoading,
    latestAnime,
    latestManga,
    latestPageInfo,
    latestLoading,
    latestError,
    mangaAvailability,
    availabilityNow,
    loading,
    error,
    setSearchPage,
    setLatestPage,
  } = useCatalogData({
    type,
    searchQuery,
    availabilityMedia,
    trackAvailabilityNow: Boolean(personalized && !searchQuery),
  });
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

  const hero = searchQuery ? searchResults?.items[0] : trending[0];
  const mediaName = type === "ANIME" ? "anime" : "manga";
  const searchItems = searchResults?.items ?? [];

  return (
    <section className={`catalog-page ${type === "MANGA" ? "manga-catalog" : "anime-catalog"}`}>
      {hero ? (
        <motion.header
          key={`${type}:${searchQuery}:${hero.id}`}
          className="catalog-hero"
          style={{
            backgroundImage: `linear-gradient(90deg, #141414 5%, rgba(20,20,20,.88) 42%, rgba(20,20,20,.18) 76%), linear-gradient(0deg, #141414 0%, transparent 45%), ${safeBackgroundUrl(hero.bannerUrl ?? hero.coverUrl)}`,
          }}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.35, ease: "easeOut" }}
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
                (personalized
                  ? `Discover ${hero.title} and keep your progress synced with AniList.`
                  : `Discover ${hero.title}, then watch or read without connecting an account.`)}
            </p>
            <div className="hero-actions">
              <button className="play-action" type="button" onClick={() => onPrimary(hero)}>
                {type === "ANIME" ? <Play size={20} fill="currentColor" /> : <BookOpen size={20} />}
                {type === "ANIME" ? "Watch" : "Read"}
              </button>
              <button className="info-action" type="button" onClick={() => onSelect(hero)}>
                <Info size={20} />
                More info
              </button>
            </div>
          </div>
        </motion.header>
      ) : !searchQuery && trendingLoading ? (
        <div className="catalog-hero catalog-hero-skeleton" aria-hidden="true" />
      ) : null}

      <div className="catalog-content">
        {error ? <p className="error-banner">{error}</p> : null}
        {searchQuery && loading && !searchItems.length ? (
          <div className="catalog-loading">Loading AniList catalog…</div>
        ) : null}
        {!searchQuery && trendingLoading && !trending.length && !malTrendingFallback.length ? (
          <section className="media-rail" aria-label={`Trending ${mediaName}`}>
            <div className="rail-heading">
              <div>
                <p className="catalog-kicker">Loading</p>
                <h2>Trending {mediaName}</h2>
              </div>
            </div>
            <div className="rail-skeleton-row" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => (
                <span className="rail-card-skeleton" key={`trending-skeleton-${index}`} />
              ))}
            </div>
          </section>
        ) : null}

        {searchQuery ? (
          <>
            <div className="catalog-toolbar">
              <div>
                <p className="catalog-kicker">Search</p>
                <h2>{`${mediaName} results`}</h2>
              </div>
            </div>
            <div
              className={`browse-grid${loading && searchItems.length ? " is-loading" : ""}`}
              aria-busy={loading}
            >
              {searchItems.map((media) => (
                <button
                  type="button"
                  className="browse-card"
                  key={media.id}
                  onClick={() => onSelect(media)}
                >
                  <span className="browse-art">
                    <img src={media.coverUrl} alt="" loading="lazy" decoding="async" />
                    <span className="browse-hover">
                      <span className="round-action">
                        <Play size={16} fill="currentColor" />
                      </span>
                      {personalized ? (
                        <span className="round-action">
                          <Plus size={16} />
                        </span>
                      ) : null}
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
            {searchResults ? (
              <Pagination
                page={page}
                totalPages={searchResults.pageInfo.lastPage}
                hasNextPage={searchResults.pageInfo.hasNextPage}
                onPageChange={(nextPage) => {
                  setSearchPage(nextPage);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            {personalized && continueEntries.length ? (
              <MediaRail
                title={type === "ANIME" ? "Continue Watching" : "Continue Reading"}
                eyebrow="From your AniList"
                entries={continueEntries}
                onSelect={onSelect}
                onPrimary={onPrimary}
                access={access}
              />
            ) : null}

            {trending.length ? (
              <section className="media-rail" aria-label={`Trending ${mediaName}`}>
                <div className="rail-heading">
                  <div>
                    <p className="catalog-kicker">Top {trending.length} moving up now</p>
                    <h2>Trending {mediaName}</h2>
                  </div>
                </div>
                <ContentCarousel label={`Trending ${mediaName}`}>
                  {trending.map((media, index) => (
                    <div className="rail-card" key={media.id}>
                      <span className="rail-art">
                        <button
                          type="button"
                          className="rail-art-hit"
                          aria-label={`${media.title} details`}
                          onClick={() => onSelect(media)}
                        />
                        <span className="rank">{index + 1}</span>
                        <img src={media.coverUrl} alt="" loading="lazy" decoding="async" />
                        <RailHoverActions
                          title={media.title}
                          onPlay={() => onPrimary(media)}
                          onInfo={() => onSelect(media)}
                          library={
                            personalized
                              ? {
                                  inLibrary: access.libraryEntries.has(media.id),
                                  onAdd: () => void access.addToLibrary(media),
                                  onRemove: () => {
                                    const entry = access.libraryEntries.get(media.id);
                                    if (entry) void access.removeFromLibrary(entry);
                                  },
                                }
                              : undefined
                          }
                        />
                      </span>
                      <span className="shelf-copy">
                        <strong>{media.title}</strong>
                        <small>{formatLabel(media.format)}</small>
                      </span>
                    </div>
                  ))}
                </ContentCarousel>
              </section>
            ) : null}

            {!trending.length && malTrendingFallback.length ? (
              <section className="media-rail" aria-label={`Trending ${mediaName} via MyAnimeList`}>
                <div className="rail-heading">
                  <div>
                    <p className="catalog-kicker">AniList is unreachable — via MyAnimeList</p>
                    <h2>Trending {mediaName}</h2>
                  </div>
                </div>
                <ContentCarousel label={`Trending ${mediaName} via MyAnimeList`}>
                  {malTrendingFallback.map((item, index) => (
                    <a
                      className="rail-card"
                      key={item.malId}
                      href={item.malUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${item.title} on MyAnimeList`}
                    >
                      <span className="rail-art">
                        <span className="rank">{index + 1}</span>
                        <span className="rail-badge rail-badge--external">
                          <ExternalLink size={11} aria-hidden="true" />
                          MAL
                        </span>
                        {item.coverUrl ? (
                          <img src={item.coverUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                          <span className="rail-art-fallback">{item.title}</span>
                        )}
                      </span>
                      <strong>{item.title}</strong>
                      <span>{item.score ? `${item.score} MAL score` : "MyAnimeList"}</span>
                    </a>
                  ))}
                </ContentCarousel>
              </section>
            ) : null}

            {type === "ANIME" ? (
              <section
                className="latest-updates-section"
                aria-label="Latest anime updates"
                aria-busy={latestLoading}
              >
                <div className="rail-heading">
                  <div>
                    <p className="catalog-kicker">Fresh episodes from AniList airing data</p>
                    <h2>Latest Anime Updates</h2>
                  </div>
                  <span className="rail-count">Page {latestPage}</span>
                </div>
                {latestError ? <p className="latest-updates-error">{latestError}</p> : null}
                <div className="latest-updates-grid">
                  {latestLoading
                    ? Array.from({ length: 21 }, (_, index) => (
                        <span
                          className="latest-update-skeleton"
                          key={`anime-latest-skeleton-${index}`}
                          aria-hidden="true"
                        />
                      ))
                    : latestAnime.map((update) => (
                        <button
                          className="latest-update-card"
                          type="button"
                          key={update.media.id}
                          onClick={() => onSelect(update.media)}
                        >
                          <span className="latest-update-art">
                            <span className="latest-kind-badge">
                              {formatLabel(update.media.format)}
                            </span>
                            <img
                              src={update.media.coverUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          </span>
                          <span className="latest-update-meta">
                            <span>EP {update.episode}</span>
                            <span>{relativeTime(update.airedAt * 1_000)}</span>
                          </span>
                          <strong title={update.media.title}>{update.media.title}</strong>
                        </button>
                      ))}
                </div>
                {latestPageInfo ? (
                  <Pagination
                    label="Latest anime update pages"
                    page={latestPage}
                    totalPages={latestPageInfo.lastPage}
                    hasNextPage={latestPageInfo.hasNextPage}
                    onPageChange={setLatestPage}
                  />
                ) : null}
              </section>
            ) : null}

            {type === "MANGA" ? (
              <section
                className="latest-updates-section"
                aria-label="Latest manga updates"
                aria-busy={latestLoading}
              >
                <div className="rail-heading">
                  <div>
                    <p className="catalog-kicker">New chapters from MangaDex</p>
                    <h2>Latest Manga Updates</h2>
                  </div>
                  <span className="rail-count">Page {latestPage}</span>
                </div>
                {latestError ? <p className="latest-updates-error">{latestError}</p> : null}
                <div className="latest-updates-grid">
                  {latestLoading
                    ? Array.from({ length: 21 }, (_, index) => (
                        <span
                          className="latest-update-skeleton"
                          key={`manga-latest-skeleton-${index}`}
                          aria-hidden="true"
                        />
                      ))
                    : latestManga.map((update) =>
                        update.aniListId ? (
                          <button
                            className="latest-update-card"
                            type="button"
                            key={update.mangaDexId}
                            onClick={() => onSelect(toMangaCatalogMedia(update))}
                          >
                            <LatestMangaCardContent update={update} />
                          </button>
                        ) : (
                          <a
                            className="latest-update-card"
                            key={update.mangaDexId}
                            href={update.mangaDexUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`${update.title} on MangaDex`}
                          >
                            <LatestMangaCardContent update={update} />
                          </a>
                        ),
                      )}
                </div>
                {latestPageInfo ? (
                  <Pagination
                    label="Latest manga update pages"
                    page={latestPage}
                    totalPages={latestPageInfo.lastPage}
                    hasNextPage={latestPageInfo.hasNextPage}
                    onPageChange={setLatestPage}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function LatestMangaCardContent({ update }: { update: LatestMangaUpdate }): React.JSX.Element {
  return (
    <>
      <span className="latest-update-art">
        <span className="latest-kind-badge">{formatMangaKind(update.publicationKind)}</span>
        <LatestMangaCover update={update} />
      </span>
      <span className="latest-update-meta">
        <span>{update.chapter ? `CH ${update.chapter}` : "NEW CHAPTER"}</span>
        <span>{relativeTime(Date.parse(update.updatedAt))}</span>
      </span>
      <strong title={update.title}>{update.title}</strong>
    </>
  );
}

function LatestMangaCover({ update }: { update: LatestMangaUpdate }): React.JSX.Element {
  const [source, setSource] = useState(update.coverUrl);

  if (!source) {
    return <span className="latest-update-art-fallback">{update.title}</span>;
  }
  return (
    <img
      src={source}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setSource((current) =>
          current !== update.coverUrlFallback ? update.coverUrlFallback : undefined,
        );
      }}
    />
  );
}

function MediaRail({
  title,
  eyebrow,
  items,
  entries,
  onSelect,
  onPrimary,
  access,
}: {
  title: string;
  eyebrow: string;
  items?: AniListCatalogMedia[];
  entries?: AniListEntry[];
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary?: (media: AniListCatalogMedia) => void;
  access: ViewerAccess;
}): React.JSX.Element {
  const personalized = hasPersonalizedAccess(access);
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
            <div className="rail-card" key={media.id}>
              <span className="rail-art">
                <button
                  type="button"
                  className="rail-art-hit"
                  aria-label={`${media.title} details`}
                  onClick={() => (entry && onPrimary ? onPrimary(media) : onSelect(media))}
                />
                <img src={media.coverUrl} alt="" loading="lazy" decoding="async" />
                <RailHoverActions
                  title={media.title}
                  onPlay={() => (onPrimary ? onPrimary(media) : onSelect(media))}
                  onInfo={() => onSelect(media)}
                  library={
                    personalized
                      ? {
                          inLibrary: Boolean(entry),
                          onAdd: () => void access.addToLibrary(media),
                          onRemove: () => {
                            if (entry) void access.removeFromLibrary(entry);
                          },
                        }
                      : undefined
                  }
                />
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
            </div>
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

/**
 * Latest-manga rows carry an exact MangaDex-declared AniList mapping; the detail
 * modal refetches full AniList data by ID, so a minimal shell is sufficient here.
 */
function toMangaCatalogMedia(update: LatestMangaUpdate): AniListCatalogMedia {
  return {
    id: update.aniListId ?? 0,
    type: "MANGA",
    title: update.title,
    coverUrl: update.coverUrl ?? "",
    genres: [],
    siteUrl: `https://anilist.co/manga/${update.aniListId ?? 0}`,
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

export function relativeTime(timestampMs: number, now = Date.now()): string {
  if (!Number.isFinite(timestampMs)) return "recently";
  const elapsedMs = Math.max(0, now - timestampMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestampMs).toLocaleDateString();
}

function formatLabel(value?: string): string {
  return formatMediaLabel(value);
}

function formatMangaKind(value: LatestMangaUpdate["publicationKind"]): string {
  return value === "OTHER" ? "COMIC" : value;
}

function cleanDescription(value?: string): string {
  if (!value) return "";
  return decodeHtmlEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/~!/g, "")
      .replace(/!~/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
