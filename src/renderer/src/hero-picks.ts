/**
 * Personalized hero (user request 2026-10-08): each section's hero shows Trending until the viewer
 * has watched or read three titles there, then a mix of For You and "Because you watched/read"
 * picks. A personalized set is kept for two days so the hero does not reshuffle on every visit;
 * watching or reading one of its titles retires it early.
 */
export type HeroSection = "ANIME" | "MANGA" | "MORE";

export const HERO_UNLOCK_TITLES = 3;
export const HERO_CACHE_MS = 2 * 86_400_000;
export const HERO_SLIDES = 6;
const STORAGE_PREFIX = "anistream.hero.v1.";

export interface HeroSlide<T> {
  item: T;
  /** Why this title is here: "For You" or "Because you watched X". */
  reason: string;
}

export interface HeroSource<T> {
  reason: string;
  items: T[];
}

/**
 * Alternates For You with the "Because you…" rows (one title per row per turn, rows taking turns),
 * never repeating a title. Falls back to whichever source still has titles.
 */
export function mixHeroPicks<T>(
  forYou: HeroSource<T>,
  rows: HeroSource<T>[],
  key: (item: T) => string,
  limit: number,
): HeroSlide<T>[] {
  const picks: HeroSlide<T>[] = [];
  const seen = new Set<string>();
  const sources = rows.filter((row) => row.items.length);
  const depth = sources.map(() => 0);
  let forYouAt = 0;
  let turn = 0;
  const take = (source: HeroSource<T>, at: () => number, advance: () => void): boolean => {
    while (at() < source.items.length) {
      const item = source.items[at()];
      advance();
      if (seen.has(key(item))) continue;
      seen.add(key(item));
      picks.push({ item, reason: source.reason });
      return true;
    }
    return false;
  };
  const fromForYou = (): boolean =>
    take(
      forYou,
      () => forYouAt,
      () => (forYouAt += 1),
    );
  const fromRows = (): boolean => {
    for (let tries = 0; tries < sources.length; tries += 1) {
      const index = turn % sources.length;
      turn += 1;
      if (
        take(
          sources[index],
          () => depth[index],
          () => (depth[index] += 1),
        )
      )
        return true;
    }
    return false;
  };
  while (picks.length < limit) {
    const placed = picks.length % 2 === 0 ? fromForYou() || fromRows() : fromRows() || fromForYou();
    if (!placed) break;
  }
  return picks;
}

/**
 * Puts one current Trending title into a personalized set (third slide), so new and popular
 * releases still reach the hero. Titles the viewer already watched/read or that are already in
 * the set are skipped; without one the set stays fully personal.
 */
export function withTrendingSlide<T>(
  personal: T[],
  trending: T[],
  key: (item: T) => string,
  skip: (item: T) => boolean,
  size = HERO_SLIDES,
): { items: T[]; trendingKey?: string } {
  const taken = new Set(personal.map(key));
  const pick = trending.find((item) => !taken.has(key(item)) && !skip(item));
  if (!pick) return { items: personal.slice(0, size) };
  const items = personal.slice(0, size - 1);
  items.splice(Math.min(2, items.length), 0, pick);
  return { items, trendingKey: key(pick) };
}

export interface HeroCache<T> {
  owner: string;
  savedAt: number;
  slides: HeroSlide<T>[];
}

export function readHeroCache<T>(section: HeroSection, owner: string): HeroCache<T> | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + section);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof value !== "object" || value === null) return undefined;
    const cache = value as Partial<HeroCache<T>>;
    if (
      cache.owner !== owner ||
      typeof cache.savedAt !== "number" ||
      !Array.isArray(cache.slides) ||
      cache.slides.length < 2 ||
      !cache.slides.every(
        (slide) =>
          typeof slide === "object" &&
          slide !== null &&
          typeof slide.reason === "string" &&
          typeof slide.item === "object" &&
          slide.item !== null,
      )
    )
      return undefined;
    return cache as HeroCache<T>;
  } catch {
    return undefined;
  }
}

export function saveHeroCache<T>(section: HeroSection, cache: HeroCache<T>): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + section, JSON.stringify(cache));
  } catch {
    // Without storage the set lasts for this visit only.
  }
}

/** Fresh: younger than two days. Kept: none of its titles watched/read since it was saved. */
export function heroCacheState<T>(
  cache: HeroCache<T> | undefined,
  now: number,
  watchedSince: (item: T, savedAt: number) => boolean,
): "fresh" | "stale" | "retired" {
  if (!cache || cache.slides.some((slide) => watchedSince(slide.item, cache.savedAt)))
    return "retired";
  return now - cache.savedAt < HERO_CACHE_MS ? "fresh" : "stale";
}
