/**
 * "Try something new" (user request 2026-10-12): ten well-rated titles the viewer would not
 * normally pick, as a litmus test of where their taste could go. Pure; callers fetch the pool
 * (MyAnimeList rankings for anime and manga, TMDB discover and Simkl for More) and drop titles
 * the viewer knows, dismissed or hid.
 *
 * Rules, in order:
 * 1. Rated by at least 50 people, and well rated after Bayesian shrinkage (the IMDb Top 250
 *    weighted rating): WR = (v·R + m·C) / (v + m), so 52 enthusiastic votes cannot outrank a
 *    title hundreds agree on.
 * 2. Outside the usual taste: low cosine similarity to the viewer's liked-title profile, and at
 *    least one genre or central tag the viewer has barely touched ("one foot out").
 * 3. One foot in: titles that also share one of the viewer's strong tastes rank higher, so the
 *    new part arrives through something familiar (Romance fan → Romance × Historical).
 * 4. At least one obscure classic: twenty or more years old and little known.
 * 5. Outside the mainstream: art-house and thought-provoking markers (Avant Garde, Award Winning,
 *    Philosophy, Psychological, Iyashikei, documentaries…) and a small audience rank higher; More
 *    includes a documentary when one qualifies.
 * 6. Low commitment: films, OVAs, short series and short manga first.
 * 7. Variety: one per franchise, at most two per genre, no two introducing the same new taste, at
 *    most three per origin; a day-seeded jitter rotates the row daily but keeps it stable within a
 *    day.
 */
import { HYBRID_WEIGHTS, type RecommendationItemFeatures } from "../../../shared/recommendations";
import {
  addScaled,
  compareItems,
  ContentSpace,
  DAY_MS,
  dot,
  itemKey,
  knownOrigin,
  SENSITIVE_TAGS,
  type Vector,
} from "./content";
import { franchiseKeys } from "./diversity";
import type { HybridHistoryItem } from "./types";

export const TRY_NEW_SIZE = 10;
const MIN_RATERS = 50;
/** Bayesian prior: m votes at the catalogue-wide mean C (0–100 scale). */
const PRIOR_VOTES = 50;
const PRIOR_MEAN = 66;
const MIN_WEIGHTED = 72;
/** A feature the viewer has barely touched: carried by under this share of liked titles. */
const UNFAMILIAR_SHARE = 0.05;
/** A feature the viewer clearly likes. */
const FAMILIAR_SHARE = 0.15;
/** Central tags only: a passing tag says little about what a title is. */
const CENTRAL_TAG_RANK = 60;
const CLASSIC_YEARS = 20;
/** Audience below which a title counts as little known (provider list members / TMDB votes). */
const OBSCURE_AUDIENCE: Record<RecommendationItemFeatures["mediaType"], number> = {
  ANIME: 60_000,
  MANGA: 15_000,
  MOVIE: 3_000,
  TV: 1_500,
};
const MAX_PER_GENRE = 2;
const MAX_PER_ORIGIN = 3;
/** Art-house and thought-provoking markers (genres and tags, lower case). */
const OFFBEAT = new Set([
  "avant garde",
  "award winning",
  "philosophy",
  "psychological",
  "iyashikei",
  "tragedy",
  "satire",
  "surreal comedy",
  "mythology",
  "classic literature",
  "anthology",
  "rotoscoping",
  "stop motion",
  "historical",
  "history",
  "documentary",
  "politics",
  "religion",
  "visual arts",
  "performing arts",
]);
/**
 * Tags that describe a cast, a technique or a site list rather than a taste: they never count as
 * something new (or familiar). Award Winning still lifts a title through OFFBEAT.
 */
export const NOT_A_TASTE = new Set([
  "male protagonist",
  "female protagonist",
  "heterosexual",
  "primarily male cast",
  "primarily female cast",
  "primarily adult cast",
  "primarily teen cast",
  "primarily child cast",
  "primarily animal cast",
  "ensemble cast",
  "full color",
  "full cgi",
  "cgi",
  "3d animation",
  "computer animation",
  "award winning",
  "eligible titles for you should read this",
  "kids",
  "adult cast",
  "anthropomorphic",
  "anthropomorphism",
  "tv movie",
]);
const SHORT_FORMATS = new Set(["MOVIE", "OVA", "ONA", "SPECIAL", "ONE_SHOT", "TV_SHORT"]);

export interface TryNewCandidate {
  features: RecommendationItemFeatures;
  /** Total length when known: episodes for anime and shows, chapters for manga. */
  length?: number;
}

export interface TryNewPick {
  features: RecommendationItemFeatures;
  /** Heuristic rank score on a 0–100 scale; not a probability. */
  score: number;
  obscureClassic: boolean;
  documentary: boolean;
  /** The genres or tags new to the viewer that this title brings. */
  newTastes: string[];
}

interface Scored {
  candidate: TryNewCandidate;
  value: number;
  quality: number;
  classic: boolean;
  documentary: boolean;
  unfamiliar: string[];
  genres: string[];
  franchise?: string;
  origin?: string;
}

/**
 * Picks exactly `TRY_NEW_SIZE` titles (or none when fewer qualify; a half-empty litmus row says
 * nothing). `day` seeds the rotation; pass the day number of `now` in normal use.
 */
export function pickTryNew(
  history: HybridHistoryItem[],
  candidates: TryNewCandidate[],
  options: { now: number; size?: number; requireDocumentary?: boolean },
): TryNewPick[] {
  const size = options.size ?? TRY_NEW_SIZE;
  const liked = history.filter((row) => row.affinity > 0);
  if (!liked.length) return [];
  const halfLife = HYBRID_WEIGHTS.halfLifeDays * DAY_MS;
  const decay = (row: HybridHistoryItem) =>
    row.affinity * Math.pow(0.5, Math.max(0, options.now - row.occurredAt) / halfLife);

  // What the viewer already likes: weighted share of liked titles carrying each facet.
  const shares = new Map<string, number>();
  let mass = 0;
  for (const row of liked) {
    const weight = decay(row);
    mass += weight;
    for (const facet of facets(row.features)) shares.set(facet, (shares.get(facet) ?? 0) + weight);
  }
  for (const [facet, weight] of shares) shares.set(facet, weight / (mass || 1));

  const known = new Set(history.map((row) => itemKey(row.features)));
  // A spin-off, sequel, film or source of something the viewer knows is not something new.
  const related = (features: RecommendationItemFeatures): boolean =>
    (features.relations ?? []).some((relation) =>
      known.has(`${relation.mediaType}:${relation.id}`),
    ) ||
    history.some((row) =>
      (row.features.relations ?? []).some(
        (relation) =>
          relation.mediaType === features.mediaType && relation.id === features.anilistId,
      ),
    ) ||
    (Boolean(features.collectionId) &&
      history.some((row) => row.features.collectionId === features.collectionId));
  const pool = candidates.filter(
    (row) =>
      !known.has(itemKey(row.features)) &&
      !related(row.features) &&
      !row.features.isAdult &&
      (row.features.ratingCount ?? 0) >= MIN_RATERS &&
      released(row.features, options.now),
  );
  if (pool.length < size) return [];

  const space = new ContentSpace([
    ...liked.map((row) => row.features),
    ...pool.map((row) => row.features),
  ]);
  const profile: Vector = new Map();
  for (const row of liked) addScaled(profile, space.vector(row.features), decay(row));
  const norm = Math.sqrt([...profile.values()].reduce((sum, v) => sum + v * v, 0)) || 1;
  const franchises = franchiseKeys(pool.map((row) => row.features));
  const year = new Date(options.now).getUTCFullYear();
  const day = Math.floor(options.now / DAY_MS);

  const scored: Scored[] = pool.flatMap((candidate) => {
    const features = candidate.features;
    const quality = weightedRating(features);
    if (quality < MIN_WEIGHTED) return [];
    const own = facets(features);
    const tastes = own.filter((facet) => !NOT_A_TASTE.has(facet) && !SENSITIVE_TAGS.has(facet));
    const unfamiliar = tastes.filter((facet) => (shares.get(facet) ?? 0) < UNFAMILIAR_SHARE);
    if (!unfamiliar.length) return [];
    const familiar = tastes.some((facet) => (shares.get(facet) ?? 0) >= FAMILIAR_SHARE);
    const similarity = Math.max(0, dot(profile, space.vector(features)) / norm);
    const audience = features.popularity ?? Infinity;
    const obscure = audience < OBSCURE_AUDIENCE[features.mediaType];
    const started = startYear(features);
    const classic = obscure && started !== undefined && year - started >= CLASSIC_YEARS;
    const documentary = own.includes("documentary");
    const offbeat = own.some((facet) => OFFBEAT.has(facet));
    const value =
      ((quality - MIN_WEIGHTED + 8) / 36) *
      Math.pow(1 - Math.min(1, similarity), 0.7) *
      (familiar ? 1.15 : 1) *
      (offbeat ? 1.15 : 1) *
      (obscure ? 1.1 : 1) *
      (short(candidate) ? 1.1 : 1) *
      // Day-seeded jitter: a new row each day, the same row all day.
      (0.9 + 0.2 * unit(`${day}:${itemKey(features)}`));
    return [
      {
        candidate,
        value,
        quality,
        classic,
        documentary,
        unfamiliar,
        genres: features.genres.map((genre) => genre.toLocaleLowerCase()),
        franchise: franchises.get(itemKey(features)),
        origin: knownOrigin(features),
      },
    ];
  });
  scored.sort(
    (a, b) => b.value - a.value || compareItems(a.candidate.features, b.candidate.features),
  );

  const picked: Scored[] = [];
  const genreCount = new Map<string, number>();
  const originCount = new Map<string, number>();
  const newTastes = new Set<string>();
  const franchisesTaken = new Set<string>();
  const fits = (row: Scored): boolean =>
    !picked.includes(row) &&
    (!row.franchise || !franchisesTaken.has(row.franchise)) &&
    row.genres.every((genre) => (genreCount.get(genre) ?? 0) < MAX_PER_GENRE) &&
    (!row.origin || (originCount.get(row.origin) ?? 0) < MAX_PER_ORIGIN) &&
    // Each pick brings at least one new taste no earlier pick brought.
    row.unfamiliar.some((facet) => !newTastes.has(facet));
  const take = (row: Scored): void => {
    picked.push(row);
    if (row.franchise) franchisesTaken.add(row.franchise);
    for (const genre of row.genres) genreCount.set(genre, (genreCount.get(genre) ?? 0) + 1);
    if (row.origin) originCount.set(row.origin, (originCount.get(row.origin) ?? 0) + 1);
    for (const facet of row.unfamiliar) newTastes.add(facet);
  };
  // Guaranteed slots first: the best obscure classic, then (More) the best documentary.
  const classic = scored.find((row) => row.classic);
  if (classic) take(classic);
  if (options.requireDocumentary) {
    const documentary = scored.find((row) => row.documentary && fits(row));
    if (documentary) take(documentary);
  }
  for (const row of scored) {
    if (picked.length >= size) break;
    if (fits(row)) take(row);
  }
  // Relax variety step by step (never the rating, the novelty or one-per-franchise) before
  // giving up on a full row: first a third title per genre, then no genre cap.
  for (const cap of [MAX_PER_GENRE + 1, Infinity])
    for (const row of scored) {
      if (picked.length >= size) break;
      if (
        !picked.includes(row) &&
        (!row.franchise || !franchisesTaken.has(row.franchise)) &&
        row.genres.every((genre) => (genreCount.get(genre) ?? 0) < cap)
      )
        take(row);
    }
  if (picked.length < size || !picked.some((row) => row.classic)) return [];

  // Best first, with the classic second: seen early without leading a row of unknowns.
  const ordered = [...picked].sort((a, b) => b.value - a.value);
  const at = ordered.findIndex((row) => row.classic);
  if (at > 1) ordered.splice(1, 0, ...ordered.splice(at, 1));
  return ordered.map((row) => ({
    features: row.candidate.features,
    score: Math.round(Math.min(100, row.quality) * 100) / 100,
    obscureClassic: row.classic,
    documentary: row.documentary,
    newTastes: row.unfamiliar
      .slice(0, 3)
      .map((facet) => displayName(row.candidate.features, facet)),
  }));
}

/** Bayesian weighted rating on a 0–100 scale (MyAnimeList's mean when known). */
export function weightedRating(features: RecommendationItemFeatures): number {
  const rating = features.malScore !== undefined ? features.malScore * 10 : features.averageScore;
  const votes = features.ratingCount ?? 0;
  if (rating === undefined || votes <= 0) return 0;
  return (votes * rating + PRIOR_VOTES * PRIOR_MEAN) / (votes + PRIOR_VOTES);
}

/**
 * Genres and central tags, lower case (AniList, MyAnimeList and TMDB names share one space), plus
 * where the title comes from: a film's original language or an anime's country is a taste too
 * (world cinema, Chinese animation, Korean comics).
 */
export function facets(features: RecommendationItemFeatures): string[] {
  const names = new Set<string>();
  for (const genre of features.genres) names.add(genre.toLocaleLowerCase());
  for (const tag of features.tags)
    if ((tag.rank ?? 0) >= CENTRAL_TAG_RANK) names.add(tag.name.toLocaleLowerCase());
  const origin = knownOrigin(features);
  if (origin) names.add(`${ORIGIN_PREFIX}${origin.toLocaleLowerCase()}`);
  return [...names];
}

export const ORIGIN_PREFIX = "origin:";
const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/** "Japanese cinema" for a film's language, "From China" for an anime's country of origin. */
function originName(features: RecommendationItemFeatures, code: string): string {
  try {
    if (features.mediaType === "MOVIE" || features.mediaType === "TV") {
      const name = LANGUAGES.of(code);
      return name && name !== code ? `${name}-language` : code.toUpperCase();
    }
    const name = REGIONS.of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? `From ${name}` : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** A facet in the provider's own spelling ("Avant Garde"), title-cased when it had none. */
export function displayName(features: RecommendationItemFeatures, facet: string): string {
  if (facet.startsWith(ORIGIN_PREFIX))
    return originName(features, facet.slice(ORIGIN_PREFIX.length));
  const named = [...features.genres, ...features.tags.map((tag) => tag.name)].find(
    (name) => name.toLocaleLowerCase() === facet,
  );
  return named && named !== named.toLocaleLowerCase()
    ? named
    : facet.replace(
        /(^|[\s-])(\p{L})/gu,
        (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase(),
      );
}

function startYear(features: RecommendationItemFeatures): number | undefined {
  if (features.startedOn) return Math.floor(features.startedOn / 10_000);
  const year = features.releaseDate ? Number(features.releaseDate.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

function released(features: RecommendationItemFeatures, now: number): boolean {
  if (features.status === "NOT_YET_RELEASED") return false;
  if (features.releaseDate) {
    const date = Date.parse(features.releaseDate);
    return !Number.isFinite(date) || date <= now;
  }
  return true;
}

function short(candidate: TryNewCandidate): boolean {
  if (candidate.features.format && SHORT_FORMATS.has(candidate.features.format)) return true;
  if (candidate.features.mediaType === "MOVIE") return true;
  if (candidate.length === undefined || candidate.length <= 0) return false;
  return candidate.features.mediaType === "MANGA" ? candidate.length <= 60 : candidate.length <= 13;
}

/** A stable pseudo-random number in [0, 1) from a string (FNV-1a). */
function unit(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 4294967296;
}
