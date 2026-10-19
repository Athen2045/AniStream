/**
 * "Because you like Romance + Comedy" (user request 2026-10-12): the viewer's favourite pair of
 * tastes, and titles that keep one half and swap the other for a new partner (Romance + Action,
 * Comedy + Drama). Serendipity that stays connected to what the viewer likes (Kotkov et al.'s
 * survey; Adamopoulos & Tuzhilin's "unexpectedness").
 *
 * Pair strength: liked titles carrying both tastes, weighted like the ranker (affinity × recency;
 * other sections at the cross-section prior), smoothed toward zero (w / (w + k)) so a pair seen
 * once or twice cannot win, times its lift over chance, ln(1 + P(a,b) / (P(a)·P(b))). At least
 * three liked titles must carry the pair. The top three rotate by day.
 */
import {
  HYBRID_WEIGHTS,
  recommendationSection,
  type RecommendationSection,
} from "../../../shared/recommendations";
import { compareItems, DAY_MS, itemKey, SENSITIVE_TAGS } from "./content";
import { franchiseKeys } from "./diversity";
import { pickContext, toPick } from "./picks";
import { displayName, facets, NOT_A_TASTE, ORIGIN_PREFIX } from "./try-new";
import type { HybridHistoryItem, HybridPick, HybridScored } from "./types";

const PAIR_SHRINK = 1.5;
/** Two tastes that share more than this share of the rarer one's titles are near-synonyms. */
const SYNONYM_SHARE = 0.6;
const MIN_PAIR_TITLES = 3;
const TOP_PAIRS = 3;
/** A combination the viewer has met on at most this many liked titles counts as new. */
const NEW_COMBO_TITLES = 1;
/** Rows hold at most this many titles with the same new combination. */
const MAX_PER_COMBO = 2;
/** A tag (not a genre) can be the new partner only if this share of liked titles carry it. */
const MIN_TAG_PARTNER_SHARE = 0.03;

export interface PairPick {
  pick: HybridPick;
  /** The kept taste and its new partner, in the providers' own spelling. */
  combo: [string, string];
}

export interface HybridPairRow {
  /** The viewer's favourite pair, in the providers' own spelling. */
  pair: [string, string];
  items: PairPick[];
}

export interface TastePair {
  a: string;
  b: string;
  score: number;
  titles: number;
}

/** Tastes that can form a pair: genres and central tags (no origin, cast or warning tags). */
function pairFacets(features: HybridHistoryItem["features"]): string[] {
  return facets(features).filter(
    (facet) =>
      !facet.startsWith(ORIGIN_PREFIX) && !NOT_A_TASTE.has(facet) && !SENSITIVE_TAGS.has(facet),
  );
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface PairStats {
  single: Map<string, number>;
  pair: Map<string, number>;
  /** Liked titles of this section carrying each pair (unweighted). */
  titles: Map<string, number>;
  total: number;
}

function pairStats(history: HybridHistoryItem[], section: RecommendationSection, now: number) {
  const halfLife = HYBRID_WEIGHTS.halfLifeDays * DAY_MS;
  const stats: PairStats = { single: new Map(), pair: new Map(), titles: new Map(), total: 0 };
  for (const row of history) {
    if (row.affinity <= 0) continue;
    const sameSection = recommendationSection(row.features.mediaType) === section;
    const weight =
      row.affinity *
      Math.pow(0.5, Math.max(0, now - row.occurredAt) / halfLife) *
      (sameSection ? 1 : HYBRID_WEIGHTS.crossTypePrior);
    if (weight <= 0) continue;
    const own = pairFacets(row.features);
    stats.total += weight;
    for (const facet of own) stats.single.set(facet, (stats.single.get(facet) ?? 0) + weight);
    for (let i = 0; i < own.length; i += 1)
      for (let j = i + 1; j < own.length; j += 1) {
        const key = pairKey(own[i], own[j]);
        stats.pair.set(key, (stats.pair.get(key) ?? 0) + weight);
        if (sameSection) stats.titles.set(key, (stats.titles.get(key) ?? 0) + 1);
      }
  }
  return stats;
}

/**
 * The viewer's strongest taste pairs in this section, strongest first. Lift is measured against
 * the catalogue the viewer is offered (`corpus`: candidates of this section), so a pair
 * scores for being liked more often than it occurs, not for always occurring together: pairs where
 * one taste nearly always brings the other (Mecha + Super Robot) are near-synonyms and skipped.
 */
export function rankTastePairs(
  history: HybridHistoryItem[],
  section: RecommendationSection,
  now: number,
  corpus: ReadonlyArray<HybridHistoryItem["features"]> = history.map((row) => row.features),
): TastePair[] {
  const stats = pairStats(history, section, now);
  if (stats.total <= 0) return [];
  const catalog = catalogStats(corpus, section);
  return [...stats.pair.entries()]
    .flatMap(([key, weight]) => {
      const titles = stats.titles.get(key) ?? 0;
      if (titles < MIN_PAIR_TITLES) return [];
      const [a, b] = key.split("|");
      const together = catalog.pair.get(key) ?? 0;
      const fewer = Math.min(catalog.single.get(a) ?? 0, catalog.single.get(b) ?? 0);
      if (fewer > 0 && together / fewer > SYNONYM_SHARE) return [];
      // P(a,b) among liked titles over P(a,b) in the catalogue, smoothed by one title.
      const liked = weight / stats.total;
      const base = (together + 1) / (catalog.size + 1);
      return [
        {
          a,
          b,
          titles,
          score: (weight / (weight + PAIR_SHRINK)) * Math.log(1 + liked / base),
        },
      ];
    })
    .sort((x, y) => y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
}

/** Unweighted taste and pair counts over a catalogue of one section (each title once). */
function catalogStats(
  corpus: ReadonlyArray<HybridHistoryItem["features"]>,
  section: RecommendationSection,
) {
  const single = new Map<string, number>();
  const pair = new Map<string, number>();
  const seen = new Set<string>();
  for (const features of corpus) {
    const key = itemKey(features);
    if (seen.has(key) || recommendationSection(features.mediaType) !== section) continue;
    seen.add(key);
    const own = pairFacets(features);
    for (const facet of own) single.set(facet, (single.get(facet) ?? 0) + 1);
    for (let i = 0; i < own.length; i += 1)
      for (let j = i + 1; j < own.length; j += 1) {
        const pk = pairKey(own[i], own[j]);
        pair.set(pk, (pair.get(pk) ?? 0) + 1);
      }
  }
  return { single, pair, size: seen.size };
}

/**
 * One row for one of the viewer's top pairs (rotating by day): the best-ranked unshown titles that
 * keep exactly one half of the pair and bring a partner the viewer has (almost) never had with it,
 * preferring partners they like on their own. Both halves are kept in turn; one per franchise.
 */
export function pairRowHybrid(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  section: RecommendationSection,
  shown: ReadonlySet<string>,
  options: { now: number; perRow?: number; minItems?: number },
): HybridPairRow | undefined {
  const { now, perRow = 10, minItems = 6 } = options;
  // Base rates come from the candidates only: the viewer's own titles would make their favourite
  // mix look like a synonym pair.
  const pairs = rankTastePairs(
    history,
    section,
    now,
    scored.map((row) => row.features),
  ).slice(0, TOP_PAIRS);
  if (!pairs.length) return undefined;
  const stats = pairStats(history, section, now);
  const share = (facet: string) => (stats.single.get(facet) ?? 0) / (stats.total || 1);
  const context = pickContext(history);
  const day = Math.floor(now / DAY_MS);
  // Today's pair first, then the others if today's cannot fill a row.
  const order = pairs.map((_, at) => pairs[(day + at) % pairs.length]);
  for (const { a, b } of order) {
    const options = scored.flatMap((row) => {
      if (shown.has(itemKey(row.features))) return [];
      const own = pairFacets(row.features);
      const hasA = own.includes(a);
      const hasB = own.includes(b);
      if (hasA === hasB) return [];
      const kept = hasA ? a : b;
      // Partners are genres (Romance + Action), or tags the viewer already meets now and then;
      // a niche tag alone ("Trains") is no taste to try.
      const genres = new Set(row.features.genres.map((genre) => genre.toLocaleLowerCase()));
      const partners = own
        .filter((facet) => facet !== a && facet !== b)
        .filter((facet) => (stats.titles.get(pairKey(kept, facet)) ?? 0) <= NEW_COMBO_TITLES)
        .filter((facet) => genres.has(facet) || share(facet) >= MIN_TAG_PARTNER_SHARE)
        .sort(
          (x, y) =>
            Number(genres.has(y)) - Number(genres.has(x)) ||
            share(y) - share(x) ||
            x.localeCompare(y),
        );
      if (!partners.length) return [];
      const partner = partners[0];
      // A partner the viewer already likes alone makes the new mix easier to try.
      const value = row.rawScore * (1 + 0.3 * Math.min(1, share(partner) / 0.15));
      return [{ row, kept, partner, value }];
    });
    options.sort((x, y) => y.value - x.value || compareItems(x.row.features, y.row.features));
    const franchise = franchiseKeys(options.map((option) => option.row.features));
    const picked: typeof options = [];
    const combos = new Map<string, number>();
    const franchises = new Set<string>();
    const keptCount = new Map<string, number>();
    const fits = (option: (typeof options)[number], balance: boolean): boolean => {
      const combo = pairKey(option.kept, option.partner);
      const group = franchise.get(itemKey(option.row.features));
      if (picked.includes(option)) return false;
      if (group && franchises.has(group)) return false;
      if ((combos.get(combo) ?? 0) >= MAX_PER_COMBO) return false;
      // Keep both halves in play: neither may take more than 60 % of the row while balancing.
      return !balance || (keptCount.get(option.kept) ?? 0) < Math.ceil(perRow * 0.6);
    };
    for (const balance of [true, false])
      for (const option of options) {
        if (picked.length >= perRow) break;
        if (!fits(option, balance)) continue;
        picked.push(option);
        const group = franchise.get(itemKey(option.row.features));
        if (group) franchises.add(group);
        const combo = pairKey(option.kept, option.partner);
        combos.set(combo, (combos.get(combo) ?? 0) + 1);
        keptCount.set(option.kept, (keptCount.get(option.kept) ?? 0) + 1);
      }
    if (picked.length < minItems) continue;
    const named = (facet: string) => {
      for (const row of [
        ...history.map((item) => item.features),
        ...scored.map((item) => item.features),
      ])
        if (pairFacets(row).includes(facet)) return displayName(row, facet);
      return facet;
    };
    picked.sort((x, y) => y.value - x.value || compareItems(x.row.features, y.row.features));
    return {
      pair: [named(a), named(b)],
      items: picked.map((option) => ({
        pick: toPick({ ...option.row, seedKey: undefined }, context, false),
        combo: [
          displayName(option.row.features, option.kept),
          displayName(option.row.features, option.partner),
        ],
      })),
    };
  }
  return undefined;
}
