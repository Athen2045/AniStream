import { BookOpen, Info, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { AniListCatalogMedia, AniListMediaType } from "../../shared/contracts";
import { CoverImage } from "./CoverImage";
import { formatMediaLabel } from "./format-label";
import { decodeHtmlEntities } from "../../shared/text";
import { motionTransition } from "./motion";
import { useAppPreferences } from "./app-preferences";
import { titleAccentStyle, titleTintStyle } from "./title-accent";
import { cachedArtworkUrl } from "../../shared/artwork";
import { useDocumentVisible } from "./useDocumentVisible";
import type { ContinueTitle } from "../../shared/personal-library";

const HERO_ROTATE_MS = 9_000;

/**
 * The section hero carousel. Its rotation state lives here so a slide change re-renders only the
 * hero, not the rails below it.
 */
export function CatalogHero({
  type,
  items,
  trending,
  continuing,
  personal,
  personalized,
  reducedMotion,
  onSelect,
  onPrimary,
}: {
  type: AniListMediaType;
  items: AniListCatalogMedia[];
  trending: AniListCatalogMedia[];
  /** Set when the slides come from Continue (Trending unavailable). */
  continuing?: ContinueTitle[];
  /** A personalized set labels only its one live Trending slide, when it has one. */
  personal?: { trendingKey?: string };
  personalized: boolean;
  reducedMotion: boolean;
  onSelect: (media: AniListCatalogMedia) => void;
  onPrimary: (media: AniListCatalogMedia, targetUnit?: number) => void;
}): React.JSX.Element | null {
  const preferences = useAppPreferences();
  const [heroIndex, setHeroIndex] = useState(0);
  const [held, setHeroPaused] = useState(false);
  // A minimized window rests the rotation like hovering does.
  const visible = useDocumentVisible();
  const heroPaused = held || !visible;
  const hero = items[heroIndex] ?? items[0];
  const heroContinue = continuing?.find((item) => item.media.id === hero?.id);
  const autoAdvance = preferences.heroRotate && !reducedMotion;
  const rotating = autoAdvance && !heroPaused && items.length > 1;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(
      () => setHeroIndex((index) => (index + 1) % items.length),
      HERO_ROTATE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [heroIndex, items.length, rotating]);
  const [heroImageState, setHeroImageState] = useState<{ id: number; source?: string }>({ id: 0 });
  const mediaName = type === "ANIME" ? "anime" : "manga";
  if (!hero) return null;
  const heroImageSource =
    heroImageState.id === hero.id ? heroImageState.source : (hero.bannerUrl ?? hero.coverUrl);

  return (
    <motion.header
      className="home-hero"
      style={{
        ...(type === "MANGA" ? titleAccentStyle(hero.coverColor) : undefined),
        ...titleTintStyle(hero.coverColor),
      }}
      aria-roledescription="carousel"
      aria-label={`Trending ${mediaName}`}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={motionTransition(reducedMotion, "entrance")}
      onMouseEnter={() => setHeroPaused(true)}
      onMouseLeave={() => setHeroPaused(false)}
      onFocus={() => setHeroPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeroPaused(false);
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
                setHeroImageState({
                  id: hero.id,
                  source:
                    heroImageSource === hero.bannerUrl && hero.coverUrl !== hero.bannerUrl
                      ? hero.coverUrl
                      : undefined,
                });
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
            {personal && personal.trendingKey !== String(hero.id) ? null : (
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
                {formatMediaLabel(hero.season)} {hero.seasonYear}
              </span>
            ) : (
              <span>{formatMediaLabel(hero.format)}</span>
            )}
          </p>
          <h1>{hero.title}</h1>
          <div className="title-stats">
            {hero.averageScore ? <span className="title-score">{hero.averageScore}%</span> : null}
            {type === "ANIME" ? <span>{formatMediaLabel(hero.format)}</span> : null}
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
              {type === "ANIME" ? <Play size={18} fill="currentColor" /> : <BookOpen size={18} />}
              {heroContinue?.label ?? (type === "ANIME" ? "Watch" : "Read")}
            </button>
            <button className="title-library" type="button" onClick={() => onSelect(hero)}>
              <Info size={17} />
              Details
            </button>
          </div>
        </div>
      </motion.div>
      {items.length > 1 ? (
        <div
          className="hero-dots home-hero-dots"
          role="tablist"
          aria-label={`Trending ${mediaName}`}
        >
          {items.map((media, position) => (
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
  );
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
