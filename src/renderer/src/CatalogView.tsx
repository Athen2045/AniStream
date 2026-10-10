import { BookOpen, ExternalLink, Info, Play } from "lucide-react";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  AniListCatalogMedia,
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
import { useAppPreferences } from "./app-preferences";
import { PersonalLibrary } from "./PersonalLibrary";
import { useAppReducedMotion } from "./useAppReducedMotion";
import { AniListSourceIcon } from "./AniListSourceIcon";
import { titleAccentStyle } from "./title-accent";
import { usePersonalLibrary } from "./PersonalLibraryProvider";
import { cachedArtworkUrl } from "../../shared/artwork";
import { startBrowsing } from "./play-timer";
import { sharedDiscoverySession } from "./discovery-session";
import type { DiscoveryFeed } from "../../shared/discovery";
import { HERO_SLIDES, mixHeroPicks, withTrendingSlide } from "./hero-picks";
import { usePersonalHero } from "./usePersonalHero";
import { LegalFooter } from "./LegalFooter";
import { hasHiddenGenre, useHiddenTags } from "./hidden-tags";

const NO_AVAILABILITY_MEDIA: [] = [];
const HERO_SIZE = 6;
const HERO_ROTATE_MS = 9_000;
const noSubscribe = (): (() => void) => () => undefined;

export function CatalogView({
  type,
  access,
  onSelect,
  onPrimary,
  onLibrary,
}: {
  type: AniListMediaType;
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
  const personalized = hasPersonalizedAccess(access);
  const preferences = useAppPreferences();
  const {
    latestPage,
    trending: allTrending,
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
    availabilityMedia: NO_AVAILABILITY_MEDIA,
    trackAvailabilityNow: false,
    latest: preferences.latestUpdates,
  });
  // Genres hidden in Settings stay out of Trending and the hero.
  const hiddenTags = useHiddenTags();
  const trending = useMemo(
    () => allTrending.filter((media) => !hasHiddenGenre(media.genres, hiddenTags)),
    [allTrending, hiddenTags],
  );

  const { state: libraryState } = usePersonalLibrary();
  const continuing = libraryState.continuing[type];

  // One For You feed per section and viewer, shared by the hero and the For You rail.
  const forYouKey =
    access.kind === "member" && preferences.forYou
      ? `${type}:${access.dashboard.profile.id}`
      : undefined;
  const forYouSession = useMemo(
    () => (forYouKey ? sharedDiscoverySession(forYouKey, type) : undefined),
    [forYouKey, type],
  );
  useEffect(() => {
    if (!forYouSession) return;
    forYouSession.activate();
    // Shared for the app session: returning to this section shows the feed it already has.
    void forYouSession.ensure(Number.POSITIVE_INFINITY);
  }, [forYouSession]);
  const forYouFeedSnapshot = (): DiscoveryFeed | undefined => forYouSession?.getSnapshot().feed;
  const forYouFeed = useSyncExternalStore(
    forYouSession?.subscribe ?? noSubscribe,
    forYouFeedSnapshot,
    forYouFeedSnapshot,
  );
  const verb = type === "MANGA" ? "read" : "watched";
  // From three titles watched/read here, the hero mixes For You with "Because you…" picks.
  const personalHero = usePersonalHero<AniListCatalogMedia>({
    section: type,
    owner: access.kind === "member" ? String(access.dashboard.profile.id) : undefined,
    enabled: Boolean(forYouKey),
    feedKey: forYouFeed?.requestId,
    sectionTitles: forYouFeed?.sectionTitles,
    build: async () => {
      if (!forYouFeed) return [];
      const picks = mixHeroPicks(
        { reason: "For You", items: forYouFeed.items },
        (forYouFeed.rows ?? [])
          .filter((row) => !row.theme)
          .map((row) => ({ reason: `Because you ${verb} ${row.seedTitle}`, items: row.items })),
        (item) => String(item.anilistId),
        12,
      );
      if (picks.length < 2) return [];
      const media = await window.anistream.getAniListMediaByIds(
        picks.map((pick) => pick.item.anilistId),
        type,
      );
      const byId = new Map(media.map((item) => [item.id, item]));
      const slides = picks.flatMap((pick) => {
        const item = byId.get(pick.item.anilistId);
        return item ? [{ item, reason: pick.reason }] : [];
      });
      // Wide banner artwork reads best in the hero; covers fill in only when banners are scarce.
      const wide = slides.filter((slide) => slide.item.bannerUrl);
      return (wide.length >= 2 ? wide : slides).slice(0, HERO_SLIDES);
    },
    watchedSince: (item, savedAt) =>
      (libraryState.activityAt.get(`${type}:${item.id}`) ?? 0) > savedAt,
  });

  // Otherwise rotate through the top trending titles, preferring ones with wide banner artwork.
  // When trending is unavailable (AniList down or offline) the hero falls back to Continue titles,
  // whose data and artwork are kept locally, so the hero never collapses.
  const heroFromContinue = !personalHero && !trending.length && !trendingLoading;
  // A personalized set keeps one live Trending slide (not cached, so it stays current).
  const personalSet = useMemo(
    () =>
      personalHero &&
      withTrendingSlide(
        personalHero.map((slide) => slide.item),
        trending.slice(0, 12).filter((media) => media.bannerUrl),
        (media) => String(media.id),
        (media) => libraryState.activityAt.has(`${type}:${media.id}`),
      ),
    [libraryState.activityAt, personalHero, trending, type],
  );
  const heroItems = useMemo(() => {
    if (personalSet) return personalSet.items;
    const top = heroFromContinue ? continuing.map((item) => item.media) : trending.slice(0, 12);
    const withBanners = top.filter((media) => media.bannerUrl);
    return (withBanners.length >= 2 ? withBanners : top).slice(0, HERO_SIZE);
  }, [continuing, heroFromContinue, personalSet, trending]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const hero = heroItems[heroIndex] ?? heroItems[0];
  const heroContinue = heroFromContinue
    ? continuing.find((item) => item.media.id === hero?.id)
    : undefined;
  const autoAdvance = preferences.heroRotate && !reducedMotion;
  const rotating = autoAdvance && !heroPaused && heroItems.length > 1;
  // Time to play starts when this section opens.
  useEffect(() => startBrowsing(type), [type]);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(
      () => setHeroIndex((index) => (index + 1) % heroItems.length),
      HERO_ROTATE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [heroIndex, heroItems.length, rotating]);
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
          key={type}
          className="home-hero"
          style={type === "MANGA" ? titleAccentStyle(hero.coverColor) : undefined}
          aria-roledescription="carousel"
          aria-label={`Trending ${mediaName}`}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionTransition(reducedMotion, "entrance")}
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
          onFocus={() => setHeroPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setHeroPaused(false);
          }}
        >
          {/* AniList banners are a fixed 1900×400: the band keeps that ratio instead of cropping. */}
          <div
            className={`title-band home-hero-band${
              heroImageSource && heroImageSource === hero.coverUrl ? " title-band--fallback" : ""
            }`}
            aria-hidden="true"
          >
            <AnimatePresence initial={false}>
              {heroImageSource ? (
                <motion.img
                  key={`art:${hero.id}`}
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.8 }}
                  className="title-band-art"
                  src={cachedArtworkUrl(heroImageSource)}
                  alt=""
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
                />
              ) : null}
            </AnimatePresence>
          </div>
          <motion.div
            key={`copy:${hero.id}`}
            className="home-hero-row"
            aria-live="polite"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.45, delay: reducedMotion ? 0 : 0.12 }}
          >
            <button
              type="button"
              className={`title-cover home-hero-cover${type === "MANGA" ? " title-cover--book" : ""}`}
              aria-label={`Details for ${hero.title}`}
              onClick={() => onSelect(hero)}
            >
              <CoverImage src={cachedArtworkUrl(hero.coverUrl)} title={hero.title} />
            </button>
            <div className="home-hero-copy">
              <p className="title-kicker">
                {/* Personalized slides carry no label; only Continue and Trending ones do. */}
                {personalSet && personalSet.trendingKey !== String(hero.id) ? null : (
                  <span className="home-hero-rank">
                    {heroContinue
                      ? type === "ANIME"
                        ? "Continue watching"
                        : "Continue reading"
                      : `#${trending.indexOf(hero) + 1} Trending`}
                  </span>
                )}
                {type === "ANIME" && hero.season && hero.seasonYear ? (
                  <span>
                    {formatLabel(hero.season)} {hero.seasonYear}
                  </span>
                ) : (
                  <span>{formatLabel(hero.format)}</span>
                )}
              </p>
              <h1>{hero.title}</h1>
              <div className="title-stats">
                {hero.averageScore ? (
                  <span className="title-score">{hero.averageScore}%</span>
                ) : null}
                {type === "ANIME" ? <span>{formatLabel(hero.format)}</span> : null}
                {hero.totalProgress ? (
                  <span>
                    {hero.totalProgress} {type === "ANIME" ? "episodes" : "chapters"}
                  </span>
                ) : null}
                {hero.genres.length ? <span>{hero.genres.slice(0, 2).join(" · ")}</span> : null}
              </div>
              <p className="home-hero-synopsis">
                {cleanDescription(hero.description) ||
                  (personalized
                    ? `Discover ${hero.title} and keep your progress synced with AniList.`
                    : `Discover ${hero.title}, then watch or read without connecting an account.`)}
              </p>
              <div className="title-actions">
                <button
                  className="title-primary"
                  type="button"
                  onClick={() => onPrimary(hero, heroContinue?.targetUnit)}
                >
                  {type === "ANIME" ? (
                    <Play size={18} fill="currentColor" />
                  ) : (
                    <BookOpen size={18} />
                  )}
                  {heroContinue?.label ?? (type === "ANIME" ? "Watch" : "Read")}
                </button>
                <button className="title-library" type="button" onClick={() => onSelect(hero)}>
                  <Info size={17} />
                  Details
                </button>
              </div>
            </div>
          </motion.div>
          {heroItems.length > 1 ? (
            <div
              className="hero-dots home-hero-dots"
              role="tablist"
              aria-label={`Trending ${mediaName}`}
            >
              {heroItems.map((media, position) => (
                <button
                  key={media.id}
                  type="button"
                  role="tab"
                  aria-selected={media.id === hero.id}
                  aria-label={`Show ${media.title}`}
                  className={media.id === hero.id ? "active" : undefined}
                  onClick={() => setHeroIndex(position)}
                >
                  {media.id === hero.id && autoAdvance ? (
                    <span
                      key={`${heroIndex}:${heroPaused ? "p" : "r"}`}
                      className={heroPaused ? "paused" : undefined}
                      style={{ animationDuration: `${HERO_ROTATE_MS}ms` }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </motion.header>
      ) : trendingLoading ? (
        <div className="home-hero home-hero-skeleton" aria-hidden="true">
          <div className="title-band" />
        </div>
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

        {/* For You right after Continue: the most relevant picks first. */}
        {access.kind === "member" && forYouSession ? (
          <ForYouRail
            key={`for-you:${forYouKey}`}
            session={forYouSession}
            type={type}
            onSelect={onSelect}
            onPrimary={onPrimary}
            onLibrary={onLibrary}
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

        {type === "ANIME" && preferences.latestUpdates ? (
          <section
            className="latest-updates-section"
            aria-label="Latest anime updates"
            aria-busy={latestLoading}
          >
            <div className="rail-heading">
              <div className="source-heading">
                <h2>Latest Anime Updates</h2>
                <AniListSourceIcon label="AniList source" />
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

        {type === "MANGA" && preferences.latestUpdates ? (
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
        <LegalFooter />
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
