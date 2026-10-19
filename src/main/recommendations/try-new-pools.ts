/**
 * Candidate pools for "Try something new" (user request 2026-10-12): MyAnimeList rankings for
 * anime and manga (exact rater counts, art-house genres such as Avant Garde), TMDB discover and
 * Simkl's top-rated documentaries for More. Each pool is a few bounded requests a day; the feed
 * services cache the result. `engine/try-new.ts` decides what the viewer sees.
 */
import type { AniListMediaType, MoreMediaType } from "../../shared/contracts";
import type {
  RecommendationItemFeatures,
  RecommendationMediaType,
} from "../../shared/recommendations";
import type { MalExploreItem } from "../mal";
import type { SimklPick } from "../simkl/service";
import { itemKey, weightedRating, type TryNewCandidate } from "./engine";

const DAY_MS = 86_400_000;
/** MyAnimeList titles mapped to AniList per section a day (two `idMal_in` pages of 50). */
const MAL_PICKS = 100;
const MAL_PAGE = 50;
/** MyAnimeList ranking pages hold 500 titles. */
const MAL_RANKING_PAGE = 500;
/** Of those, places kept for old, little-known titles (the obscure-classic rule). */
const MAL_CLASSIC_PICKS = 15;
/** Top of the score-sorted list sampled from, so the pool rotates day to day. */
const MAL_SAMPLE_FROM = 400;
const MAL_MIN_RATERS = 50;
const MAL_MIN_MEAN = 7.2;
/** Audience above which a title is mainstream enough that the viewer would find it anyway. */
const MAL_MAX_MEMBERS: Record<AniListMediaType, number> = { ANIME: 150_000, MANGA: 40_000 };
const MAL_CLASSIC_MEMBERS: Record<AniListMediaType, number> = { ANIME: 60_000, MANGA: 15_000 };
const CLASSIC_YEARS = 20;
/** MyAnimeList genres become tags of this strength (AniList has no Avant Garde, for instance). */
const MAL_GENRE_RANK = 70;
/** Simkl picks not already in the TMDB pools, looked up on TMDB one at a time. */
const SIMKL_LOOKUPS = 6;
/** World cinema rotates through these original languages, one a day. */
export const WORLD_LANGUAGES = [
  "fr",
  "it",
  "ja",
  "ko",
  "de",
  "es",
  "sv",
  "fa",
  "pt",
  "pl",
  "da",
  "zh",
  "hi",
  "ml",
  "ta",
  "bn",
  "tr",
  "ru",
  "cs",
  "hu",
];

export interface AniListTryNewDeps {
  ranking(
    type: AniListMediaType,
    rankingType: "all" | "movie" | "ova" | "manga" | "oneshots",
    offset?: number,
  ): Promise<MalExploreItem[]>;
  byMalIds(
    type: AniListMediaType,
    ids: number[],
    signal?: AbortSignal,
  ): Promise<RecommendationItemFeatures[]>;
}

/** MyAnimeList rankings → exact AniList features, with MyAnimeList's score, raters and genres. */
export async function aniListTryNewPool(
  deps: AniListTryNewDeps,
  type: AniListMediaType,
  now: number,
  options: { signal?: AbortSignal; knownMalIds?: ReadonlySet<number> } = {},
): Promise<TryNewCandidate[]> {
  // The top 1,000 by score plus films and OVAs (anime) or one-shots (manga): 3–4 requests a day.
  const rankings: Array<["all" | "movie" | "ova" | "manga" | "oneshots", number]> =
    type === "ANIME"
      ? [
          ["all", 0],
          ["all", MAL_RANKING_PAGE],
          ["movie", 0],
          ["ova", 0],
        ]
      : [
          ["manga", 0],
          ["manga", MAL_RANKING_PAGE],
          ["oneshots", 0],
        ];
  const items: MalExploreItem[] = [];
  for (const [ranking, offset] of rankings)
    items.push(...(await deps.ranking(type, ranking, offset)));
  // Titles on the viewer's lists never take one of the mapped places.
  const known = options.knownMalIds ?? new Set<number>();
  const chosen = preselectMal(
    items.filter((item) => !known.has(item.malId)),
    type,
    now,
  );
  if (!chosen.length) return [];
  const byId = new Map(chosen.map((item) => [item.malId, item]));
  const features: RecommendationItemFeatures[] = [];
  for (let at = 0; at < chosen.length; at += MAL_PAGE)
    features.push(
      ...(await deps.byMalIds(
        type,
        chosen.slice(at, at + MAL_PAGE).map((item) => item.malId),
        options.signal,
      )),
    );
  return features.flatMap((row) => {
    const mal = row.malId === undefined ? undefined : byId.get(row.malId);
    if (!mal) return [];
    const known = new Set([
      ...row.genres.map((genre) => genre.toLocaleLowerCase()),
      ...row.tags.map((tag) => tag.name.toLocaleLowerCase()),
    ]);
    return [
      {
        features: {
          ...row,
          malScore: mal.mean,
          ratingCount: mal.raters,
          tags: [
            ...row.tags,
            ...mal.genres
              .filter((genre) => !known.has(genre.toLocaleLowerCase()))
              .map((name) => ({ id: 0, name, rank: MAL_GENRE_RANK })),
          ],
        },
        length: mal.length,
      },
    ];
  });
}

/**
 * Up to 100 MyAnimeList titles worth mapping today: rated by 50+ people, well rated, not
 * mainstream; old little-known titles keep their own places; the rest are a day-seeded sample of
 * the best 200, so the pool changes daily.
 */
export function preselectMal(
  items: MalExploreItem[],
  type: AniListMediaType,
  now: number,
): MalExploreItem[] {
  const year = new Date(now).getUTCFullYear();
  const seen = new Set<number>();
  const qualified = items
    .filter((item) => {
      if (seen.has(item.malId)) return false;
      seen.add(item.malId);
      return (
        item.raters >= MAL_MIN_RATERS &&
        item.mean >= MAL_MIN_MEAN &&
        item.members <= MAL_MAX_MEMBERS[type]
      );
    })
    .map((item) => ({ item, rating: weightedRating(asFeatures(item, type)) }))
    .sort((a, b) => b.rating - a.rating || a.item.malId - b.item.malId);
  const classics = qualified
    .filter(
      ({ item }) =>
        item.year !== undefined &&
        year - item.year >= CLASSIC_YEARS &&
        item.members < MAL_CLASSIC_MEMBERS[type],
    )
    .slice(0, MAL_CLASSIC_PICKS);
  const taken = new Set(classics.map(({ item }) => item.malId));
  const day = Math.floor(now / DAY_MS);
  const rest = qualified
    .slice(0, MAL_SAMPLE_FROM)
    .filter(({ item }) => !taken.has(item.malId))
    .map((row) => ({ row, order: unit(`${day}:${row.item.malId}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, MAL_PICKS - classics.length)
    .map(({ row }) => row);
  return [...classics, ...rest].map(({ item }) => item);
}

function asFeatures(
  item: MalExploreItem,
  type: RecommendationMediaType,
): RecommendationItemFeatures {
  return {
    anilistId: item.malId,
    mediaType: type,
    normalizedTitle: "",
    titleTokens: [],
    synonyms: [],
    genres: [],
    tags: [],
    creators: [],
    malScore: item.mean,
    ratingCount: item.raters,
    updatedAt: 0,
  };
}

export interface MoreTryNewDeps {
  pool(
    type: MoreMediaType,
    pool: "documentary" | "classic" | "world",
    language?: string,
  ): Promise<RecommendationItemFeatures[]>;
  candidate(id: number, type: MoreMediaType): Promise<RecommendationItemFeatures | undefined>;
  /** Simkl's top-rated documentaries; absent or empty while Simkl is not connected. */
  simklDocumentaries?: () => Promise<SimklPick[]>;
}

export interface MoreTryNewPool {
  candidates: TryNewCandidate[];
  /** simkl.com pages of the candidates that came from Simkl, by item key. */
  simklLinks: Map<string, string>;
}

/**
 * TMDB documentaries (films and series), old little-known films and one world-cinema language a
 * day, plus Simkl's top-rated documentary series when Simkl is connected. A failed source is
 * skipped; the others still count.
 */
export async function moreTryNewPool(deps: MoreTryNewDeps, now: number): Promise<MoreTryNewPool> {
  // Two world-cinema languages a day, half the list apart, so a fortnight covers all of them.
  const day = Math.floor(now / DAY_MS);
  const languages = [
    WORLD_LANGUAGES[day % WORLD_LANGUAGES.length],
    WORLD_LANGUAGES[(day + WORLD_LANGUAGES.length / 2) % WORLD_LANGUAGES.length],
  ];
  const requests: Array<() => Promise<RecommendationItemFeatures[]>> = [
    () => deps.pool("MOVIE", "documentary"),
    () => deps.pool("TV", "documentary"),
    () => deps.pool("MOVIE", "classic"),
    ...languages.map((language) => () => deps.pool("MOVIE", "world", language)),
  ];
  const features = new Map<string, RecommendationItemFeatures>();
  for (const request of requests) {
    try {
      for (const row of await request())
        if (!features.has(itemKey(row))) features.set(itemKey(row), row);
    } catch {
      // One source down leaves the others.
    }
  }
  const simklLinks = new Map<string, string>();
  try {
    let lookups = 0;
    for (const pick of (await deps.simklDocumentaries?.()) ?? []) {
      const key = `${pick.type}:${pick.tmdbId}`;
      if (!features.has(key)) {
        if (lookups >= SIMKL_LOOKUPS) continue;
        lookups += 1;
        const row = await deps.candidate(pick.tmdbId, pick.type);
        if (!row) continue;
        features.set(key, row);
      }
      simklLinks.set(key, pick.link);
    }
  } catch {
    // Simkl (or a TMDB lookup) failed: the TMDB pools stand on their own.
  }
  return {
    candidates: [...features.values()].map((row) => ({ features: row })),
    simklLinks,
  };
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
