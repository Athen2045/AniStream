import { useEffect, useMemo, useRef, useState } from "react";
import {
  HERO_UNLOCK_TITLES,
  heroCacheState,
  readHeroCache,
  saveHeroCache,
  type HeroCache,
  type HeroSection,
  type HeroSlide,
} from "./hero-picks";

/**
 * The section's personalized hero slides, or undefined while Trending should lead (personal picks
 * off, fewer than three titles watched/read, or no set built yet).
 *
 * A saved set younger than two days is shown as is. An older one still shows on this visit while a
 * replacement is built and saved for the next, so the hero never swaps under the viewer. A set
 * with a title watched/read since it was saved is retired at once.
 */
export function usePersonalHero<T>({
  section,
  owner,
  enabled,
  feedKey,
  sectionTitles,
  build,
  watchedSince,
}: {
  section: HeroSection;
  /** Whose taste the set reflects; a set saved for someone else is ignored. */
  owner?: string;
  enabled: boolean;
  /** Changes whenever a new For You feed arrives. */
  feedKey?: string;
  /** Titles watched/read in this section, from the latest feed. */
  sectionTitles?: number;
  /** Turns the current feed into slides (may fetch artwork). */
  build: () => Promise<HeroSlide<T>[]>;
  watchedSince: (item: T, savedAt: number) => boolean;
}): HeroSlide<T>[] | undefined {
  const saved = useMemo(
    () => (enabled && owner ? readHeroCache<T>(section, owner) : undefined),
    [enabled, owner, section],
  );
  const [built, setBuilt] = useState<HeroCache<T>>();
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });

  // Age is judged once per visit, so a set never expires while it is on screen.
  const [now] = useState(() => Date.now());
  const savedState = heroCacheState(saved, now, watchedSince);
  const builtState = heroCacheState(built?.owner === owner ? built : undefined, now, watchedSince);
  const unlocked = (sectionTitles ?? 0) >= HERO_UNLOCK_TITLES;
  const needsBuild = Boolean(
    enabled && owner && unlocked && savedState !== "fresh" && builtState === "retired",
  );

  useEffect(() => {
    if (!needsBuild || !feedKey || !owner) return;
    let alive = true;
    void buildRef
      .current()
      .then((slides) => {
        if (!alive || slides.length < 2) return;
        const next = { owner, savedAt: Date.now(), slides };
        saveHeroCache(section, next);
        setBuilt(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [feedKey, needsBuild, owner, section]);

  if (!enabled) return undefined;
  if (saved && savedState !== "retired") return saved.slides;
  if (built && builtState !== "retired") return built.slides;
  return undefined;
}
