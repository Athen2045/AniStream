import { AnimatePresence, motion } from "framer-motion";
import { Info, Play, Star } from "lucide-react";
import { MoreSaveMenu } from "./MoreSaveMenu";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MoreCatalogItem, MoreDetail } from "../../shared/contracts";
import type { MoreCardActions } from "./MorePosterCard";
import { formatDuration, formatScore, moreKey, releaseState } from "./more-format";
import { ReleasePill } from "./ReleasePill";
import { useAppPreferences } from "./app-preferences";
import { useDocumentVisible } from "./useDocumentVisible";
import { useArtworkTint } from "./artwork-tint";
import { titleTintStyle } from "./title-accent";

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
  const [held, setPaused] = useState(false);
  // A minimized window rests the rotation like hovering does.
  const visible = useDocumentVisible();
  const paused = held || !visible;
  const [details, setDetails] = useState<Record<string, MoreDetail>>({});
  const active = items[Math.min(index, items.length - 1)];
  const activeLoaded = active ? Boolean(details[moreKey(active)]) : true;

  // The slide on screen asks first, ahead of the page's background requests (a request already
  // queued for it moves up); the other slides follow at normal priority. Each logo is preloaded.
  useEffect(() => {
    if (!active || activeLoaded) return;
    let alive = true;
    void window.anistream
      .getMoreDetail(active.id, active.type, true)
      .then((detail) => {
        preloadLogo(detail.logoUrl);
        if (alive) setDetails((current) => ({ ...current, [moreKey(active)]: detail }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [active, activeLoaded]);

  useEffect(() => {
    let alive = true;
    for (const item of items) {
      void window.anistream
        .getMoreDetail(item.id, item.type)
        .then((detail) => {
          preloadLogo(detail.logoUrl);
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

  const tint = useArtworkTint(active?.posterUrl);
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
      style={titleTintStyle(tint)}
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

const preloadedLogos = new Set<string>();

/** Warms the image cache, so a slide's logo is ready before the carousel reaches it. */
function preloadLogo(url: string | undefined): void {
  if (!url || preloadedLogos.has(url)) return;
  preloadedLogos.add(url);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
}

/**
 * TMDB logo artwork when available, otherwise the plain title as a heading. The title text stays
 * until the logo has loaded, then the logo fades in (no blank gap, no abrupt swap); a logo already
 * in the image cache shows at once.
 */
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
  const [loadedLogo, setLoadedLogo] = useState<string>();
  const [instantLogo, setInstantLogo] = useState<string>();
  const image = useRef<HTMLImageElement>(null);
  const Heading = level === 1 ? "h1" : "h2";
  const usable = logoUrl && failedLogo !== logoUrl ? logoUrl : undefined;
  // Decoded from the cache before paint: show it without the fade.
  useLayoutEffect(() => {
    const element = image.current;
    if (usable && element?.complete && element.naturalWidth > 0) {
      setLoadedLogo(usable);
      setInstantLogo(usable);
    }
  }, [usable]);
  if (!usable) return <Heading className="more-title-art more-title-text">{title}</Heading>;
  const loaded = loadedLogo === usable;
  return (
    <Heading
      className={`more-title-art${loaded ? "" : " more-title-text is-loading-logo"}${
        loaded && instantLogo !== usable ? " is-fading-in" : ""
      }`}
    >
      {loaded ? null : title}
      <img
        ref={image}
        src={usable}
        alt={loaded ? title : ""}
        aria-hidden={loaded ? undefined : true}
        onLoad={() => setLoadedLogo(usable)}
        onError={() => setFailedLogo(usable)}
      />
    </Heading>
  );
}
