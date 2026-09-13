import { BookOpen, ExternalLink, Info, Play } from "lucide-react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaType,
  LatestMangaUpdate,
} from "../../shared/contracts";
import { ContentCarousel } from "./ContentCarousel";
import { Pagination } from "./Pagination";
import { CatalogCard } from "./CatalogCard";
import { CoverImage } from "./CoverImage";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { useCatalogData } from "./useCatalogData";
import { hasPersonalizedAccess, type ViewerAccess } from "./viewer-access";
import { motionTransition } from "./motion";
import { ForYouRail } from "./ForYouRail";
import { PersonalLibrary } from "./PersonalLibrary";
import { useAppReducedMotion } from "./useAppReducedMotion";

const NO_AVAILABILITY_MEDIA: [] = [];

export function CatalogView({
  type,
  access,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  type: AniListMediaType;
  searchQuery?: string;
  onLibrary?: (media: AniListCatalogMedia) => Promise<void>;
  access: ViewerAccess;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia, targetUnit?: number) => void;
}): React.JSX.Element {
  const reducedMotion = useAppReducedMotion();
  const pageRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll();
  const smoothScrollProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    mass: 0.22,
  });
  // Keep the fit-framed artwork calm while the page moves underneath it.
  const heroParallaxY = useTransform(scrollYProgress, [0, 0.2], [0, 24]);
  const personalized = hasPersonalizedAccess(access);
  const {
    latestPage,
    trending,
    malTrendingFallback,
    trendingLoading,
    latestAnime,
    latestManga,
    latestPageInfo,
    latestLoading,
    latestError,
    error,
    setLatestPage,
  } = useCatalogData({
    type,
    searchQuery: "",
    availabilityMedia: NO_AVAILABILITY_MEDIA,
    trackAvailabilityNow: false,
  });

  const hero = trending[0];
  const [heroImageState, setHeroImageState] = useState<{ id: number; source?: string }>({ id: 0 });
  const [kitsuHeroState, setKitsuHeroState] = useState<{ id: number; source?: string }>({ id: 0 });
  const mediaName = type === "ANIME" ? "anime" : "manga";
  useEffect(() => {
    if (!import.meta.env.DEV || !hero) return;

    let active = true;
    void window.anistream
      .getKitsuHeroArtwork({ aniListId: hero.id, type, title: hero.title })
      .then((artwork) => {
        if (active && artwork) setKitsuHeroState({ id: hero.id, source: artwork.imageUrl });
      })
      .catch(() => {
        // Kitsu is only a dev preview; AniList artwork should keep the page usable if it is down.
      });
    return () => {
      active = false;
    };
  }, [hero, type]);
  const heroImageSource = hero
    ? heroImageState.id === hero.id
      ? heroImageState.source
      : kitsuHeroState.id === hero.id && kitsuHeroState.source
        ? kitsuHeroState.source
        : (hero.bannerUrl ?? hero.coverUrl)
    : undefined;

  // The hero image gets the early paint; everything below it stays lazy to protect scrolling.
  return (
    <section
      ref={pageRef}
      className={`catalog-page ${type === "MANGA" ? "manga-catalog" : "anime-catalog"}`}
    >
      <motion.div
        className="catalog-scroll-progress"
        style={{ scaleX: reducedMotion ? scrollYProgress : smoothScrollProgress }}
        aria-hidden="true"
      />
      {hero ? (
        <motion.header
          key={`${type}:${hero.id}`}
          className="catalog-hero"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionTransition(reducedMotion, "entrance")}
        >
          {heroImageSource ? (
            <motion.img
              className="catalog-hero-art"
              src={heroImageSource}
              alt=""
              aria-hidden="true"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onError={() => {
                // Banners are nicer, but a stale CDN URL should never leave the hero empty.
                // Warning: do not retry the same URL here; broken provider URLs can otherwise loop.
                if (heroImageSource === kitsuHeroState.source) {
                  setKitsuHeroState({ id: hero.id });
                } else {
                  setHeroImageState({
                    id: hero.id,
                    source:
                      heroImageSource === hero.bannerUrl && hero.coverUrl !== hero.bannerUrl
                        ? hero.coverUrl
                        : undefined,
                  });
                }
              }}
              style={{ y: reducedMotion ? 0 : heroParallaxY }}
            />
          ) : (
            <div className="catalog-hero-art-fallback" aria-hidden="true" />
          )}
          <div className="catalog-hero-copy">
            <p className="catalog-kicker">Now trending</p>
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
                Details
              </button>
            </div>
          </div>
        </motion.header>
      ) : trendingLoading ? (
        <div className="catalog-hero catalog-hero-skeleton" aria-hidden="true" />
      ) : null}

      <div className="catalog-content">
        {error ? <p className="error-banner">{error}</p> : null}
        {trendingLoading && !trending.length && !malTrendingFallback.length ? (
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

        <PersonalLibrary
          key={`continue:${type}:${access.kind === "member" ? access.dashboard.profile.id : "guest"}`}
          type={type}
          access={access}
          onSelect={onSelect}
          onPrimary={onPrimary}
        />

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
                <CatalogCard
                  rank={index + 1}
                  key={media.id}
                  media={media}
                  inLibrary={personalized && access.libraryEntries.has(media.id)}
                  onSelect={onSelect}
                  onPrimary={onPrimary}
                  onLibrary={
                    onLibrary ??
                    (personalized
                      ? async (title) => {
                          await access.addToLibrary(title);
                        }
                      : undefined)
                  }
                />
              ))}
            </ContentCarousel>
          </section>
        ) : null}

        <ForYouRail
          key={`for-you:${type}:${access.kind === "member" ? access.dashboard.profile.id : "guest"}`}
          type={type}
          onSelect={onSelect}
          onPrimary={onPrimary}
          onLibrary={onLibrary}
          access={access}
        />

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
                  style={cardMotionStyle(index)}
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
              {latestLoading && !latestAnime.length
                ? Array.from({ length: 21 }, (_, index) => (
                    <span
                      className="latest-update-skeleton"
                      key={`anime-latest-skeleton-${index}`}
                      aria-hidden="true"
                    />
                  ))
                : latestAnime.map((update) => (
                    <button
                      className={`latest-update-card${latestLoading ? " is-refreshing" : ""}`}
                      type="button"
                      key={update.media.id}
                      onClick={() => onSelect(update.media)}
                    >
                      <span className="latest-update-art">
                        <span className="latest-kind-badge">
                          {formatLabel(update.media.format)}
                        </span>
                        <CoverImage src={update.media.coverUrl} title={update.media.title} />
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
              {latestLoading && !latestManga.length
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
                        className={`latest-update-card${latestLoading ? " is-refreshing" : ""}`}
                        type="button"
                        key={update.mangaDexId}
                        onClick={() => onSelect(toMangaCatalogMedia(update))}
                      >
                        <LatestMangaCardContent update={update} />
                      </button>
                    ) : (
                      <a
                        className={`latest-update-card${latestLoading ? " is-refreshing" : ""}`}
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

function cardMotionStyle(index: number): React.CSSProperties {
  return { "--card-index": Math.min(index, 5) } as React.CSSProperties;
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
