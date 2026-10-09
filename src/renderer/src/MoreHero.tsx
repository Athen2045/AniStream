import { AnimatePresence, motion } from "framer-motion";
import { Info, Play, Star } from "lucide-react";
import { MoreSaveMenu } from "./MoreSaveMenu";
import { useEffect, useState } from "react";
import type { MoreCatalogItem, MoreDetail } from "../../shared/contracts";
import type { MoreCardActions } from "./MorePosterCard";
import { formatDuration, formatScore, moreKey, releaseState } from "./more-format";
import { ReleasePill } from "./ReleasePill";
import { useAppPreferences } from "./app-preferences";

const ROTATE_MS = 9_000;

/**
 * Full-bleed TMDB backdrop carousel. Each slide upgrades to the title's detail (logo, full-size
 * backdrop, rating, genre) once it arrives; until then the catalog fields render on their own.
 */
export function MoreHero({
  items,
  actions,
  reducedMotion,
  children,
}: {
  items: MoreCatalogItem[];
  actions: MoreCardActions;
  reducedMotion: boolean;
  /** Overlay controls rendered in the hero's top-left corner (the More filter). */
  children?: React.ReactNode;
}): React.JSX.Element | null {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [details, setDetails] = useState<Record<string, MoreDetail>>({});
  const active = items[Math.min(index, items.length - 1)];

  useEffect(() => {
    let alive = true;
    for (const item of items) {
      void window.anistream
        .getMoreDetail(item.id, item.type)
        .then((detail) => {
          if (alive) setDetails((current) => ({ ...current, [moreKey(item)]: detail }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [items]);

  // Settings can turn the rotation off; reduced motion always does.
  const rotates = useAppPreferences().heroRotate && !reducedMotion;
  useEffect(() => {
    if (!rotates || paused || items.length < 2) return;
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % items.length),
      ROTATE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [index, items.length, paused, rotates]);

  if (!active) return null;
  const detail = details[moreKey(active)];
  const backdrop = detail?.heroBackdropUrl ?? active.backdropUrl ?? active.posterUrl;
  const score = formatScore(detail?.score ?? active.score);
  const genre = detail?.genres[0];
  const length =
    active.type === "MOVIE"
      ? detail?.runtimeMinutes
        ? formatDuration(detail.runtimeMinutes)
        : undefined
      : detail?.numberOfSeasons
        ? `${detail.numberOfSeasons} Season${detail.numberOfSeasons === 1 ? "" : "s"}`
        : undefined;
  const saved = actions.isSaved(active);
  const release = releaseState(detail?.releaseDate ?? active.releaseDate, detail?.status);

  return (
    <header
      className="more-hero"
      aria-roledescription="carousel"
      aria-label="Featured movies and shows"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <AnimatePresence initial={false}>
        <motion.img
          key={moreKey(active)}
          className="more-hero-art"
          src={backdrop}
          alt=""
          aria-hidden="true"
          initial={reducedMotion ? false : { opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </AnimatePresence>
      <div className="more-hero-shade" aria-hidden="true" />
      {children ? <div className="more-hero-top">{children}</div> : null}
      <motion.div
        key={`copy:${moreKey(active)}`}
        className="more-hero-copy"
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.5, delay: reducedMotion ? 0 : 0.15 }}
        aria-live="polite"
      >
        <MoreTitleArt title={active.title} logoUrl={detail?.logoUrl} level={1} />
        <div className="more-facts">
          {score ? (
            <span className="more-score">
              <Star size={16} fill="currentColor" aria-hidden="true" />
              {score}
            </span>
          ) : null}
          {active.year ? <span>{active.year}</span> : null}
          {genre ? <span>{genre}</span> : null}
          {length ? <span>{length}</span> : null}
          {detail?.certification ? <span className="more-cert">{detail.certification}</span> : null}
        </div>
        {active.overview ? <p className="more-hero-overview">{active.overview}</p> : null}
        <div className="more-actions">
          {release.unreleased ? (
            <ReleasePill label={release.label} />
          ) : (
            <button
              className="more-btn-play"
              type="button"
              onClick={() => actions.onPrimary(active)}
            >
              <Play size={20} fill="currentColor" /> Play
            </button>
          )}
          <div className="more-btn-pair">
            <MoreSaveMenu
              title={active.title}
              iconSize={21}
              saved={saved}
              completed={actions.isCompleted(active)}
              onAction={(action) => actions.onSetStatus(active, action)}
            />
            <span aria-hidden="true" />
            <button
              type="button"
              aria-label={`Details for ${active.title}`}
              title="Details"
              onClick={() => actions.onSelect(active)}
            >
              <Info size={21} />
            </button>
          </div>
        </div>
      </motion.div>
      {items.length > 1 ? (
        <div className="hero-dots more-hero-dots" role="tablist" aria-label="Featured titles">
          {items.map((item, position) => (
            <button
              key={moreKey(item)}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={`Show ${item.title}`}
              className={position === index ? "active" : undefined}
              onClick={() => setIndex(position)}
            >
              {position === index && rotates ? (
                <span
                  key={`${index}:${paused ? "p" : "r"}`}
                  className={paused ? "paused" : undefined}
                  style={{ animationDuration: `${ROTATE_MS}ms` }}
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/** TMDB logo artwork when available, otherwise the plain title as a heading. */
export function MoreTitleArt({
  title,
  logoUrl,
  level,
}: {
  title: string;
  logoUrl?: string;
  level: 1 | 2;
}): React.JSX.Element {
  const [failedLogo, setFailedLogo] = useState<string>();
  const Heading = level === 1 ? "h1" : "h2";
  if (logoUrl && failedLogo !== logoUrl) {
    return (
      <Heading className="more-title-art">
        <img src={logoUrl} alt={title} onError={() => setFailedLogo(logoUrl)} />
      </Heading>
    );
  }
  return <Heading className="more-title-art more-title-text">{title}</Heading>;
}
