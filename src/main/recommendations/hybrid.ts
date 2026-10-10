import type { DiscoveryRow } from "../../shared/discovery";
import {
  HYBRID_WEIGHTS,
  recommendationSection,
  type RecommendationEdge,
  type RecommendationItemFeatures,
  type RecommendationItemType,
  type RecommendationMediaType,
  type RecommendationReasonCode,
  type RecommendationRelation,
  type RecommendationResult,
  type RecommendationSection,
} from "../../shared/recommendations";

const DAY_MS = 86_400_000;
/**
 * Soft diversity (X's author-diversity scorer: (1 - floor) * decay^n + floor for the n-th repeat).
 * Repeats of a seed, a franchise or a studio fade instead of being cut off at a fixed count.
 */
const SEED_FADE = { decay: 0.6, floor: 0.35 };
const FRANCHISE_FADE = { decay: 0.4, floor: 0.15 };
const STUDIO_FADE = { decay: 0.75, floor: 0.5 };
const MAX_PER_FRANCHISE_IN_ROW = 2;
/** Top-ranked titles the diverse selection considers. */
const SELECTION_POOL = 120;
/** Calibration smoothing (Steck's alpha): keeps unseen genres from an infinite divergence. */
const CALIBRATION_ALPHA = 0.01;
/** Ignored picks: shown on this many days without being opened before they start to fade. */
const IGNORED_FREE_DAYS = 2;
const IGNORED_FADE = 0.8;
const IGNORED_FLOOR = 0.35;
/** Freshness (YouTube): titles airing now, or released within this window, rank a little higher. */
const AIRING_BOOST = 1.12;
const RECENT_BOOST = 1.08;
const RECENT_DAYS = 180;
/** "In-network": the released next entry of a liked title. */
const CONTINUATION_BOOST = 1.25;
/** Relations that keep two titles in one franchise for diversity. */
const FRANCHISE_RELATIONS = new Set<RecommendationRelation["relationType"]>([
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
]);
const MIN_TAG_RANK = 40;
/** Zero-based rail position of the exploration pick (the seventh card). */
const EXPLORE_SLOT = 6;
const EXPLORE_MIN_SCORE = 75;
/** Cosine floor for filling a seed row by content; below it a title is not "like" the seed. */
const MIN_ROW_SIMILARITY = 0.25;
/** Positions (0-based) where cross-type titles go in a seed row, so they are seen early. */
const CROSS_TYPE_SLOTS = [2, 5, 8];
/**
 * TMDB keywords that describe production or source rather than a theme a viewer follows
 * ("aftercreditsstinger", "sequel", "based on comic"); never offered as a theme row.
 */
const NOT_A_THEME = new Set([
  "aftercreditsstinger",
  "duringcreditsstinger",
  "sequel",
  "prequel",
  "remake",
  "reboot",
  "spin off",
  "live action remake",
  "live action and animation",
  "woman director",
  "3d",
  "imax",
  "short film",
  "anime",
  "duringcreditsscene",
  "aftercreditsscene",
  "based on comic",
  "based on comic book",
  "based on manga",
  "based on novel or book",
  "based on video game",
  "based on true story",
  "based on play or musical",
  "based on young adult novel",
  "based on children's book",
  "based on short story",
  "based on tv series",
  "based on movie",
]);

const CROSS_SECTION = new Set<RecommendationRelation["relationType"]>([
  "ADAPTATION",
  "SOURCE",
  "ALTERNATIVE",
]);

export interface HybridHistoryItem {
  features: RecommendationItemFeatures;
  /** Viewer affinity in [-1, 1]; dismissals are -1. */
  affinity: number;
  occurredAt: number;
}

export interface HybridRankInput {
  section: RecommendationSection;
  history: HybridHistoryItem[];
  candidates: RecommendationItemFeatures[];
  now: number;
  weights?: Partial<Record<keyof typeof HYBRID_WEIGHTS, number>>;
}

export interface HybridScored {
  features: RecommendationItemFeatures;
  rawScore: number;
  graph: number;
  content: number;
  /** Item key of the liked history title contributing the most graph weight. */
  seedKey?: string;
}

/** A selected candidate, independent of which provider's result shape the caller needs. */
export interface HybridPick {
  features: RecommendationItemFeatures;
  /** Heuristic rank score on a 0–100 scale; not a probability. */
  score: number;
  reasonCodes: RecommendationReasonCode[];
  seed?: RecommendationItemFeatures;
}

export interface HybridSeedRow {
  seed: RecommendationItemFeatures;
  items: HybridPick[];
}

type Vector = Map<string, number>;

export interface SeedRowOptions {
  maxRows?: number;
  perRow?: number;
  minItems?: number;
  /** Source of the seed order; a value near 1 keeps the newest-first order (tests). */
  random?: () => number;
  /**
   * Slots per row for the closest titles of the other media type (More: shows in a movie's row
   * and movies in a show's), spread through the row. Provider edges never cross types.
   */
  crossType?: number;
}

export interface PickOptions {
  /** Each media type gets at least this many picks when one ranks in the top `balanceWithin`. */
  minPerType?: number;
  balanceWithin?: number;
  /**
   * Calibration strength in [0, 1] (Netflix, Steck 2018): how much the rail should follow the
   * viewer's genre mix instead of filling up with their single strongest taste. 0 turns it off.
   */
  calibrate?: number;
}

/** Score changes applied after ranking (`adjustScores`). */
export interface ScoreAdjustments {
  now: number;
  /** Days each title (item key) was shown without being opened since. */
  ignored?: ReadonlyMap<string, number>;
  /** Released next entries of liked titles (item keys), the "in-network" source. */
  continuation?: ReadonlySet<string>;
}

/** In-place Fisher–Yates shuffle. */
function shuffle<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.min(index, Math.floor(random() * (index + 1)));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
}

/** Items from different providers can share numeric IDs; always key by type and ID. */
export function itemKey(item: { mediaType: RecommendationItemType; anilistId: number }): string {
  return `${item.mediaType}:${item.anilistId}`;
}

function edgeKey(edge: { mediaType: RecommendationItemType; id: number }): string {
  return `${edge.mediaType}:${edge.id}`;
}

/**
 * Ranks candidates by provider recommendation edges from liked history (graph), IDF-weighted
 * content similarity to the viewer's taste vector, and popularity/quality priors. History from
 * other sections counts at the cross-section prior weight. Pure: callers own retrieval,
 * exclusion, and persistence.
 */
export function rankHybrid(input: HybridRankInput): HybridScored[] {
  const weights = { ...HYBRID_WEIGHTS, ...input.weights };
  const candidates = input.candidates.filter(
    (row) => recommendationSection(row.mediaType) === input.section,
  );
  const space = new ContentSpace([...input.history.map((row) => row.features), ...candidates]);
  const halfLife = weights.halfLifeDays * DAY_MS;
  const profile: Vector = new Map();
  const graph = new Map<string, { total: number; best: number; seed?: string }>();

  for (const item of input.history) {
    const decay = Math.pow(0.5, Math.max(0, input.now - item.occurredAt) / halfLife);
    const sameSection = recommendationSection(item.features.mediaType) === input.section;
    const weight = item.affinity * decay * (sameSection ? 1 : weights.crossTypePrior);
    if (!weight) continue;
    addScaled(profile, space.vector(item.features), weight);
    const edges = item.features.recommendations ?? [];
    const maxRating = Math.max(1, ...edges.map((edge) => edge.rating));
    for (const edge of edges) {
      const key = edgeKey(edge);
      const contribution = weight * (Math.log1p(edge.rating) / Math.log1p(maxRating));
      const current = graph.get(key) ?? { total: 0, best: 0 };
      current.total += contribution;
      if (contribution > current.best) {
        current.best = contribution;
        current.seed = itemKey(item.features);
      }
      graph.set(key, current);
    }
  }

  const profileNorm = Math.sqrt([...profile.values()].reduce((sum, v) => sum + v * v, 0));
  const maxGraph = Math.max(1e-9, ...[...graph.values()].map((row) => row.total));
  return candidates
    .map((features) => {
      const content =
        profileNorm > 0 ? Math.max(0, dot(profile, space.vector(features)) / profileNorm) : 0;
      const edge = graph.get(itemKey(features));
      const graphScore = Math.max(0, edge?.total ?? 0) / maxGraph;
      return {
        features,
        graph: graphScore,
        content,
        seedKey: graphScore > 0 ? edge?.seed : undefined,
        rawScore:
          weights.graph * graphScore +
          weights.content * content +
          weights.popularity * popularityPrior(features) +
          weights.quality * qualityPrior(features),
      };
    })
    .sort((a, b) => b.rawScore - a.rawScore || compareItems(a.features, b.features));
}

/**
 * Picks the top results while letting no single history title supply more than three, and
 * reserves one slot for a well-rated title outside the viewer's usual taste so popular,
 * similar picks cannot fill the whole rail.
 */
export function pickHybrid(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  limit = 10,
  options: PickOptions = {},
): HybridPick[] {
  const picked = selectDiverse(scored, history, limit, options.calibrate ?? 0);
  if (options.minPerType) balanceTypes(picked, scored, options.minPerType, options.balanceWithin);

  const explore = limit > EXPLORE_SLOT ? explorationPick(scored, picked) : undefined;
  if (explore) {
    if (picked.length >= limit) {
      // The exploration slot never takes a type below its minimum.
      const min = options.minPerType ?? 0;
      const count = (type: string) =>
        picked.filter((row) => row.features.mediaType === type).length;
      let drop = picked.length - 1;
      while (
        drop > 0 &&
        picked[drop].features.mediaType !== explore.features.mediaType &&
        count(picked[drop].features.mediaType) <= min
      )
        drop -= 1;
      picked.splice(drop, 1);
    }
    picked.splice(Math.min(EXPLORE_SLOT, picked.length), 0, explore);
  }
  const context = pickContext(history);
  return picked.map((row) => toPick(row, context, row === explore));
}

/**
 * "Because you watched/read X" rows from liked titles of this section, picked in a random order on
 * every load so the rows rotate through the viewer's whole history, not only the latest titles.
 * Each row starts with the seed's own recommendation edges, then fills with the candidates whose
 * content (tags, genres, creators) is closest to that seed, since a heavy viewer has often seen
 * most direct edges. Rows never repeat a title already shown (keys) or an earlier row.
 */
export function seedRowsHybrid(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  section: RecommendationSection,
  shown: ReadonlySet<string>,
  options: SeedRowOptions = {},
): HybridSeedRow[] {
  const { maxRows = 3, perRow = 10, minItems = 6, random = Math.random, crossType = 0 } = options;
  const used = new Set(shown);
  const context = pickContext(history);
  const space = new ContentSpace([
    ...history.map((row) => row.features),
    ...scored.map((row) => row.features),
  ]);
  const rows: HybridSeedRow[] = [];
  const seeds = history
    .filter(
      (row) =>
        row.affinity >= 0.5 &&
        recommendationSection(row.features.mediaType) === section &&
        row.features.recommendations?.length,
    )
    .sort((a, b) => b.occurredAt - a.occurredAt || compareItems(a.features, b.features));
  shuffle(seeds, random);
  const commonOrigin = mostCommon(scored.map((row) => row.features.origin));
  const franchise = franchiseKeys([
    ...history.map((row) => row.features),
    ...scored.map((row) => row.features),
  ]);
  const franchiseCap = (list: HybridScored[]): HybridScored[] => {
    const counts = new Map<string, number>();
    return list.filter((row) => {
      const key = franchise.get(itemKey(row.features));
      if (!key) return true;
      const count = counts.get(key) ?? 0;
      counts.set(key, count + 1);
      return count < MAX_PER_FRANCHISE_IN_ROW;
    });
  };
  for (const seed of seeds) {
    if (rows.length >= maxRows) break;
    // A row follows its seed's origin: a Malayalam film seeds Malayalam titles. Titles of unknown
    // origin (cached before it was recorded) pass only for the pool's common origin.
    const origin = knownOrigin(seed.features);
    const fits = (row: HybridScored): boolean =>
      !origin ||
      (row.features.origin === undefined
        ? origin === commonOrigin
        : row.features.origin === origin);
    const neighbors = new Set((seed.features.recommendations ?? []).map(edgeKey));
    const items = franchiseCap(
      scored.filter(
        (row) =>
          neighbors.has(itemKey(row.features)) && !used.has(itemKey(row.features)) && fits(row),
      ),
    ).slice(0, perRow);
    const seedVector = space.vector(seed.features);
    if (items.length < perRow) {
      const taken = new Set(items.map((row) => itemKey(row.features)));
      const similar = scored
        .flatMap((row) => {
          const key = itemKey(row.features);
          if (used.has(key) || taken.has(key) || !fits(row)) return [];
          const similarity = dot(seedVector, space.vector(row.features));
          return similarity >= MIN_ROW_SIMILARITY ? [{ row, similarity }] : [];
        })
        .sort(
          (a, b) => b.similarity - a.similarity || compareItems(a.row.features, b.row.features),
        );
      items.push(...similar.map(({ row }) => row));
      items.splice(0, items.length, ...franchiseCap(items).slice(0, perRow));
    }
    if (crossType > 0) {
      const seedType = seed.features.mediaType;
      const taken = new Set(items.map((row) => itemKey(row.features)));
      const present = items.filter((row) => row.features.mediaType !== seedType);
      const added = scored
        .flatMap((row) => {
          const key = itemKey(row.features);
          if (row.features.mediaType === seedType) return [];
          if (used.has(key) || taken.has(key) || !fits(row)) return [];
          const similarity = dot(seedVector, space.vector(row.features));
          return similarity >= MIN_ROW_SIMILARITY ? [{ row, similarity }] : [];
        })
        .sort((a, b) => b.similarity - a.similarity || compareItems(a.row.features, b.row.features))
        .slice(0, Math.max(0, crossType - present.length))
        .map(({ row }) => row);
      const cross = [...present, ...added].slice(0, Math.max(crossType, present.length));
      // The row's weakest same-type titles make room; cross-type titles go to fixed early slots.
      const mixed = items
        .filter((row) => row.features.mediaType === seedType)
        .slice(0, perRow - cross.length);
      cross.forEach((row, index) =>
        mixed.splice(Math.min(CROSS_TYPE_SLOTS[index] ?? mixed.length, mixed.length), 0, row),
      );
      items.splice(0, items.length, ...mixed);
    }
    if (items.length < minItems) continue;
    for (const row of items) used.add(itemKey(row.features));
    const seedKey = itemKey(seed.features);
    rows.push({
      seed: seed.features,
      items: items.map((row) => toPick({ ...row, seedKey }, context, false)),
    });
  }
  return rows;
}

/**
 * Gives each media type at least `min` of the picks when titles of that type rank within the
 * first `within` scored: the lowest-ranked picks of the over-represented type make room, and the
 * result stays in score order.
 */
function balanceTypes(
  picked: HybridScored[],
  scored: HybridScored[],
  min: number,
  within = 40,
): void {
  const types = [...new Set(scored.map((row) => row.features.mediaType))];
  for (const type of types) {
    const have = picked.filter((row) => row.features.mediaType === type).length;
    if (have >= min) continue;
    const extra = scored
      .slice(0, within)
      .filter((row) => row.features.mediaType === type && !picked.includes(row))
      .slice(0, min - have);
    for (const row of extra) {
      const counts = new Map<string, number>();
      for (const pick of picked)
        counts.set(pick.features.mediaType, (counts.get(pick.features.mediaType) ?? 0) + 1);
      // Remove the lowest-ranked pick of a type that can spare one.
      let drop = -1;
      for (let index = picked.length - 1; index >= 0; index -= 1)
        if (
          picked[index].features.mediaType !== type &&
          (counts.get(picked[index].features.mediaType) ?? 0) > min
        ) {
          drop = index;
          break;
        }
      if (drop < 0) break;
      picked.splice(drop, 1);
      // The newcomer takes its score's place; the rest keep their selection order.
      const at = picked.findIndex((pick) => pick.rawScore < row.rawScore);
      picked.splice(at < 0 ? picked.length : at, 0, row);
    }
  }
}

/**
 * How strong a row is: the mean score of its top six cards (what fits on screen), so rows can be
 * ordered strongest first.
 */
export function rowStrength(items: ReadonlyArray<{ score: number }>): number {
  const top = items.slice(0, 6);
  return top.length ? top.reduce((sum, item) => sum + item.score, 0) / top.length : 0;
}

/** A "Because you like <theme>" row. */
export interface HybridThemeRow {
  theme: string;
  items: HybridPick[];
}

/**
 * One row for a theme (AniList tag or TMDB keyword) the viewer keeps coming back to: themes shared
 * by at least two liked titles of this section, weighted by affinity, tag strength, and rarity
 * (IDF), so "Time Travel" can win over "Male Protagonist". A random pick among the top five keeps
 * the row rotating. Items are the best-ranked unshown candidates carrying that theme.
 */
/** A theme the viewer keeps returning to, in rotation order. */
export interface HybridTheme {
  key: string;
  name: string;
  /** Provider tag/keyword ID, for fetching more titles that carry it. */
  id?: number;
  /** The item type most of the liked titles with this theme have. */
  mediaType: RecommendationItemType;
}

/**
 * Themes (AniList tags, TMDB keywords) shared by at least two liked titles of this section,
 * weighted by affinity, tag strength, and rarity (IDF), so "Time Travel" can beat "Male
 * Protagonist". Returns the top five in a random order so the theme row rotates.
 */
export function rankThemes(
  history: HybridHistoryItem[],
  section: RecommendationSection,
  corpus: RecommendationItemFeatures[] = [],
  random: () => number = Math.random,
): HybridTheme[] {
  const liked = history.filter(
    (row) => row.affinity >= 0.5 && recommendationSection(row.features.mediaType) === section,
  );
  const space = new ContentSpace([...liked.map((row) => row.features), ...corpus]);
  const themes = new Map<
    string,
    { name: string; id?: number; weight: number; titles: number; types: Map<string, number> }
  >();
  for (const row of liked)
    for (const tag of row.features.tags) {
      if ((tag.rank ?? 0) < MIN_TAG_RANK) continue;
      const key = tagKey(tag.name);
      if (NOT_A_THEME.has(key)) continue;
      const entry = themes.get(key) ?? {
        name: tag.name,
        id: tag.id,
        weight: 0,
        titles: 0,
        types: new Map<string, number>(),
      };
      entry.weight += row.affinity * ((tag.rank ?? 0) / 100) * space.rarity(`t:${key}`);
      entry.titles += 1;
      const type = row.features.mediaType;
      entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
      themes.set(key, entry);
    }
  const ranked = [...themes.entries()]
    .filter(([, entry]) => entry.titles >= 2)
    .sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, entry]) => ({
      key,
      name: entry.name,
      id: entry.id,
      mediaType: [...entry.types.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0][0] as RecommendationItemType,
    }));
  shuffle(ranked, random);
  return ranked;
}

/**
 * One "Because you like <theme>" row: the best-ranked unshown candidates carrying the first theme
 * (in rotation order) that has enough of them. Pass `themes` to reuse an earlier `rankThemes`.
 */
export function themeRowHybrid(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  section: RecommendationSection,
  shown: ReadonlySet<string>,
  options: Omit<SeedRowOptions, "maxRows"> & { themes?: HybridTheme[] } = {},
): HybridThemeRow | undefined {
  const { perRow = 10, minItems = 6, random = Math.random } = options;
  const themes =
    options.themes ??
    rankThemes(
      history,
      section,
      scored.map((row) => row.features),
      random,
    );
  const context = pickContext(history);
  for (const theme of themes) {
    const items = scored
      .filter(
        (row) =>
          !shown.has(itemKey(row.features)) &&
          row.features.tags.some(
            (tag) => (tag.rank ?? 0) >= MIN_TAG_RANK && tagKey(tag.name) === theme.key,
          ),
      )
      .slice(0, perRow);
    if (items.length >= minItems)
      return {
        theme: themeLabel(theme.name),
        items: items.map((row) => toPick({ ...row, seedKey: undefined }, context, false)),
      };
  }
  return undefined;
}

/** AniList "Because you like <theme>" row. */
export function buildThemeRow(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  type: RecommendationMediaType,
  shown: ReadonlySet<number>,
  options: Omit<SeedRowOptions, "maxRows"> = {},
): DiscoveryRow | undefined {
  const shownKeys = new Set([...shown].map((id) => `${type}:${id}`));
  const row = themeRowHybrid(scored, history, type, shownKeys, options);
  return row
    ? { seedId: 0, seedTitle: row.theme, theme: row.theme, items: row.items.map(toAniListResult) }
    : undefined;
}

/** TMDB keywords arrive lower-case ("time travel"); AniList tags are already titled. */
function themeLabel(name: string): string {
  return name === name.toLocaleLowerCase()
    ? name.replace(
        /(^|[\s-])(\p{L})/gu,
        (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase(),
      )
    : name;
}

/** TMDB's "xx" means no language; it is not a shared origin. */
function knownOrigin(item: RecommendationItemFeatures): string | undefined {
  return item.origin && item.origin !== "xx" ? item.origin : undefined;
}

function mostCommon(values: ReadonlyArray<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  for (const [value, count] of counts) if (!best || count > counts.get(best)!) best = value;
  return best;
}

/** AniList rail: picks mapped to the renderer's AniList result shape. */
export function selectHybrid(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  limit = 10,
  options: PickOptions = {},
): RecommendationResult[] {
  return pickHybrid(scored, history, limit, options).map(toAniListResult);
}

/** Picks for a fixed set of titles (the continuation row), strongest first, as rail results. */
export function continuationPicks(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  keys: ReadonlySet<string>,
  shown: ReadonlySet<string>,
  limit: number,
): HybridPick[] {
  const context = pickContext(history);
  return scored
    .filter((row) => keys.has(itemKey(row.features)) && !shown.has(itemKey(row.features)))
    .slice(0, limit)
    .map((row) => toPick(row, context, false));
}

export function toAniListResults(picks: HybridPick[]): RecommendationResult[] {
  return picks.map(toAniListResult);
}

/** AniList "Because you watched/read X" rows. */
export function buildSeedRows(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  type: RecommendationMediaType,
  shown: ReadonlySet<number>,
  options: SeedRowOptions = {},
): DiscoveryRow[] {
  const shownKeys = new Set([...shown].map((id) => `${type}:${id}`));
  return seedRowsHybrid(scored, history, type, shownKeys, options).map((row) => ({
    seedId: row.seed.anilistId,
    seedTitle: row.seed.normalizedTitle,
    items: row.items.map(toAniListResult),
  }));
}

/**
 * Hides candidates the viewer effectively knows or cannot start: the same work in the other
 * section (adaptation/source/alternative of a watched title, either direction) and later entries
 * whose prequel or parent in this section was never started. Unknown relations allow the title.
 * `watched` holds AniList IDs; relations are AniList-only.
 */
export function eligibilityFilter(
  history: RecommendationItemFeatures[],
  watched: ReadonlySet<number>,
): (candidate: RecommendationItemFeatures, storyPrequels?: readonly number[]) => boolean {
  const sameWork = new Set<string>();
  for (const item of history)
    if (watched.has(item.anilistId))
      for (const relation of item.relations ?? [])
        if (CROSS_SECTION.has(relation.relationType) && relation.mediaType !== item.mediaType)
          sameWork.add(edgeKey(relation));
  return (candidate, storyPrequels = []) => {
    if (sameWork.has(itemKey(candidate))) return false;
    for (const relation of candidate.relations ?? []) {
      if (
        CROSS_SECTION.has(relation.relationType) &&
        relation.mediaType !== candidate.mediaType &&
        watched.has(relation.id)
      )
        return false;
      if (
        (relation.relationType === "PREQUEL" || relation.relationType === "PARENT") &&
        relation.mediaType === candidate.mediaType &&
        !watched.has(relation.id) &&
        !storyPrequels.includes(relation.id)
      )
        return false;
    }
    return true;
  };
}

const MAX_PREQUEL_HOPS = 6;

/** Same-section prequels (or parents) the viewer has not started. */
function unwatchedPrequels(
  item: RecommendationItemFeatures,
  watched: ReadonlySet<number>,
): number[] {
  return (item.relations ?? [])
    .filter(
      (relation) =>
        (relation.relationType === "PREQUEL" || relation.relationType === "PARENT") &&
        relation.mediaType === item.mediaType &&
        !watched.has(relation.id),
    )
    .map((relation) => relation.id);
}

/**
 * First-season redirect: where the viewer would actually begin a later entry whose prequel they
 * never started. Follows exact AniList PREQUEL/PARENT links, but only to entries released earlier:
 * AniList orders those links by story, so a prequel made later (a "Starting Days" movie, a
 * "Beginning" reboot, a spin-off set before the main story) is not where a newcomer starts. Those
 * are returned as `storyPrequels`, which do not block the entry. `missing` names a link whose
 * features (or release date) are not cached yet; the caller fetches it and walks again.
 */
export function firstSeason(
  item: RecommendationItemFeatures,
  lookup: (id: number) => RecommendationItemFeatures | undefined,
  watched: ReadonlySet<number>,
):
  { entry: RecommendationItemFeatures; storyPrequels: number[] } | { missing: number } | undefined {
  const seen = new Set([item.anilistId]);
  let current = item;
  for (let hop = 0; hop < MAX_PREQUEL_HOPS; hop += 1) {
    const prequels = unwatchedPrequels(current, watched);
    // Rows cached before release dates were recorded are refetched once to learn them.
    if (prequels.length && current.startedOn === undefined) return { missing: current.anilistId };
    if (!prequels.length)
      return current === item ? undefined : { entry: current, storyPrequels: [] };
    let earlier: RecommendationItemFeatures | undefined;
    const storyPrequels: number[] = [];
    for (const id of prequels) {
      if (seen.has(id)) return undefined;
      const prequel = lookup(id);
      if (!prequel) return { missing: id };
      if (prequel.startedOn === undefined) return { missing: id };
      if (prequel.startedOn >= current.startedOn!) storyPrequels.push(id);
      else if (!earlier || prequel.startedOn < earlier.startedOn!) earlier = prequel;
    }
    if (!earlier) return { entry: current, storyPrequels };
    seen.add(earlier.anilistId);
    current = earlier;
  }
  return undefined;
}

/**
 * Moves "similar to what you watched" edges from redirected sequels to their first season, keeping
 * the strongest rating when both were linked.
 */
export function redirectEdges(
  history: HybridHistoryItem[],
  redirects: ReadonlyMap<number, number>,
): HybridHistoryItem[] {
  if (!redirects.size) return history;
  return history.map((item) => {
    const edges = item.features.recommendations;
    if (!edges?.some((edge) => redirects.has(edge.id))) return item;
    const merged = new Map<string, RecommendationEdge>();
    for (const edge of edges) {
      const id = redirects.get(edge.id) ?? edge.id;
      const key = `${edge.mediaType}:${id}`;
      const known = merged.get(key);
      if (!known || edge.rating > known.rating) merged.set(key, { ...edge, id });
    }
    return { ...item, features: { ...item.features, recommendations: [...merged.values()] } };
  });
}

function toAniListResult(pick: HybridPick): RecommendationResult {
  const { features } = pick;
  if (features.mediaType !== "ANIME" && features.mediaType !== "MANGA")
    throw new Error("Only AniList items map to AniList recommendation results.");
  return {
    anilistId: features.anilistId,
    mediaType: features.mediaType,
    malId: features.malId,
    title: features.normalizedTitle,
    coverUrl: features.coverUrl,
    score: pick.score,
    reasonCodes: pick.reasonCodes,
    relatedTo: pick.seed?.anilistId,
    relatedTitle: pick.seed?.normalizedTitle,
  };
}

function explorationPick(scored: HybridScored[], picked: HybridScored[]): HybridScored | undefined {
  if (scored.length <= picked.length) return undefined;
  const contents = scored.map((row) => row.content).sort((a, b) => a - b);
  const median = contents[Math.floor(contents.length / 2)];
  const taken = new Set(picked.map((row) => itemKey(row.features)));
  let best: HybridScored | undefined;
  let bestValue = -1;
  for (const row of scored) {
    if (taken.has(itemKey(row.features)) || row.content > median) continue;
    if ((row.features.averageScore ?? 0) < EXPLORE_MIN_SCORE) continue;
    const value = 0.6 * qualityPrior(row.features) + 0.4 * popularityPrior(row.features);
    if (value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

function pickContext(history: HybridHistoryItem[]) {
  return {
    seeds: new Map(history.map((row) => [itemKey(row.features), row.features])),
    liked: tasteSets(history),
  };
}

function toPick(
  row: HybridScored,
  context: ReturnType<typeof pickContext>,
  exploration: boolean,
): HybridPick {
  const seed = row.seedKey === undefined ? undefined : context.seeds.get(row.seedKey);
  const codes = reasons({ ...row, seedKey: seed ? row.seedKey : undefined }, context.liked);
  return {
    features: row.features,
    score: Math.round(clamp(row.rawScore) * 10_000) / 100,
    reasonCodes: exploration
      ? ["explore-more", ...codes.filter((code) => code === "highly-rated")]
      : codes,
    seed,
  };
}

function reasons(
  row: HybridScored,
  liked: { tags: Set<string>; genres: Set<string>; creators: Set<string> },
): RecommendationReasonCode[] {
  const codes: RecommendationReasonCode[] = [];
  if (row.seedKey !== undefined) codes.push("similar-to");
  if (row.features.creators.some((creator) => liked.creators.has(creatorKey(creator))))
    codes.push("same-creator");
  if (
    row.features.tags.some(
      (tag) => (tag.rank ?? 0) >= MIN_TAG_RANK && liked.tags.has(tagKey(tag.name)),
    )
  )
    codes.push("matches-tag");
  else if (row.features.genres.some((genre) => liked.genres.has(genre)))
    codes.push("matches-genre");
  if ((row.features.averageScore ?? 0) >= 80) codes.push("highly-rated");
  if (!codes.length) codes.push("explore-more");
  return codes.slice(0, 3);
}

function tasteSets(history: HybridHistoryItem[]) {
  const liked = history.filter((row) => row.affinity >= 0.5).map((row) => row.features);
  return {
    tags: new Set(
      liked.flatMap((row) =>
        row.tags.filter((tag) => (tag.rank ?? 0) >= MIN_TAG_RANK).map((tag) => tagKey(tag.name)),
      ),
    ),
    genres: new Set(liked.flatMap((row) => row.genres)),
    creators: new Set(liked.flatMap((row) => row.creators.map(creatorKey))),
  };
}

function creatorKey(creator: RecommendationItemFeatures["creators"][number]): string {
  return creator.id === undefined
    ? `${creator.role}:${creator.name}`
    : `${creator.role}:${creator.id}`;
}

/** AniList tags and TMDB keywords share a case-insensitive vocabulary ("Time Travel"). */
function tagKey(name: string): string {
  return name.toLocaleLowerCase();
}

function rawVector(item: RecommendationItemFeatures): Vector {
  const vector: Vector = new Map();
  for (const genre of item.genres) vector.set(`g:${genre}`, 1);
  for (const tag of item.tags)
    if ((tag.rank ?? 0) >= MIN_TAG_RANK) vector.set(`t:${tagKey(tag.name)}`, (tag.rank ?? 0) / 100);
  for (const creator of item.creators) vector.set(`c:${creatorKey(creator)}`, 0.8);
  // Origin (language or country) is one feature among many; IDF keeps a shared origin such as
  // English nearly silent while a rarer one such as Malayalam pulls strongly.
  const origin = knownOrigin(item);
  if (origin) vector.set(`o:${origin}`, 1);
  return vector;
}

function qualityPrior(item: RecommendationItemFeatures): number {
  return clamp(((item.averageScore ?? 60) - 50) / 40);
}

function popularityPrior(item: RecommendationItemFeatures): number {
  return clamp(Math.log10(Math.max(1, item.popularity ?? 1)) / 6);
}

function compareItems(left: RecommendationItemFeatures, right: RecommendationItemFeatures): number {
  return left.anilistId - right.anilistId || left.mediaType.localeCompare(right.mediaType);
}

class ContentSpace {
  private readonly idf = new Map<string, number>();
  private readonly cache = new Map<string, Vector>();
  constructor(corpus: RecommendationItemFeatures[]) {
    const df = new Map<string, number>();
    const seen = new Set<string>();
    for (const item of corpus) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const feature of rawVector(item).keys()) df.set(feature, (df.get(feature) ?? 0) + 1);
    }
    for (const [feature, count] of df)
      this.idf.set(feature, Math.log((1 + seen.size) / (1 + count)) + 1);
  }
  /** How rare a feature is in this corpus; unseen features count as rarest-but-one. */
  rarity(feature: string): number {
    return this.idf.get(feature) ?? 1;
  }
  vector(item: RecommendationItemFeatures): Vector {
    const key = itemKey(item);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const vector: Vector = new Map();
    let norm = 0;
    for (const [feature, value] of rawVector(item)) {
      const weighted = value * (this.idf.get(feature) ?? 1);
      vector.set(feature, weighted);
      norm += weighted * weighted;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [feature, value] of vector) vector.set(feature, value / norm);
    this.cache.set(key, vector);
    return vector;
  }
}

/** Sparse dot product; the cosine when both vectors are unit length. */
function dot(left: Vector, right: Vector): number {
  let sum = 0;
  for (const [key, value] of right) sum += value * (left.get(key) ?? 0);
  return sum;
}

function addScaled(target: Vector, source: Vector, scale: number): void {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value * scale);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Score changes after ranking, in one place (user request 2026-10-10, from X, YouTube and
 * Netflix): titles shown on several days without being opened fade; titles airing now or
 * released recently rise a little; the released next entry of a liked title rises more.
 */
export function adjustScores(scored: HybridScored[], adjust: ScoreAdjustments): HybridScored[] {
  return scored
    .map((row) => {
      const key = itemKey(row.features);
      let multiplier = 1;
      const ignored = adjust.ignored?.get(key) ?? 0;
      if (ignored > IGNORED_FREE_DAYS)
        multiplier *= Math.max(IGNORED_FLOOR, IGNORED_FADE ** (ignored - IGNORED_FREE_DAYS));
      multiplier *= freshness(row.features, adjust.now);
      if (adjust.continuation?.has(key)) multiplier *= CONTINUATION_BOOST;
      return multiplier === 1 ? row : { ...row, rawScore: row.rawScore * multiplier };
    })
    .sort((a, b) => b.rawScore - a.rawScore || compareItems(a.features, b.features));
}

function freshness(item: RecommendationItemFeatures, now: number): number {
  if (item.status === "RELEASING") return AIRING_BOOST;
  if (item.status === "NOT_YET_RELEASED") return 1;
  const started =
    item.startedOn !== undefined
      ? Date.UTC(
          Math.floor(item.startedOn / 10_000),
          Math.max(0, (Math.floor(item.startedOn / 100) % 100) - 1),
          Math.max(1, item.startedOn % 100),
        )
      : item.releaseDate
        ? Date.parse(item.releaseDate)
        : NaN;
  if (!Number.isFinite(started) || started > now) return 1;
  return now - started <= RECENT_DAYS * DAY_MS ? RECENT_BOOST : 1;
}

/**
 * Franchise groups by exact relations (sequels, prequels, parents, side stories, spin-offs) and,
 * for movies, TMDB collections: two titles share a key when any chain of these links joins them.
 * Titles with no franchise link are left out.
 */
export function franchiseKeys(items: RecommendationItemFeatures[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(b)) parent.set(b, b);
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(left, right);
  };
  const linked = new Set<string>();
  for (const item of items) {
    const key = itemKey(item);
    if (!parent.has(key)) parent.set(key, key);
    for (const relation of item.relations ?? [])
      if (FRANCHISE_RELATIONS.has(relation.relationType) && relation.mediaType === item.mediaType) {
        union(key, edgeKey(relation));
        linked.add(key);
      }
    if (item.collectionId) {
      union(key, `collection:${item.collectionId}`);
      linked.add(key);
    }
  }
  const groups = new Map<string, string>();
  for (const item of items) {
    const key = itemKey(item);
    if (linked.has(key)) groups.set(key, find(key));
  }
  return groups;
}

function studioKey(item: RecommendationItemFeatures): string | undefined {
  const studio = item.creators.find(
    (creator) => creator.role === "STUDIO" || creator.role === "COMPANY",
  );
  return studio ? creatorKey(studio) : undefined;
}

function fade({ decay, floor }: { decay: number; floor: number }, repeats: number): number {
  return (1 - floor) * decay ** repeats + floor;
}

/** A genre mix from titles, each title's weight split evenly across its genres. */
function genreMix(
  items: Array<{ features: RecommendationItemFeatures; weight: number }>,
): Map<string, number> {
  const mix = new Map<string, number>();
  let total = 0;
  for (const { features, weight } of items) {
    if (weight <= 0 || !features.genres.length) continue;
    const share = weight / features.genres.length;
    for (const genre of features.genres) mix.set(genre, (mix.get(genre) ?? 0) + share);
    total += weight;
  }
  if (total > 0) for (const [genre, value] of mix) mix.set(genre, value / total);
  return mix;
}

/** KL(target || picked), with the picked mix smoothed toward the target (Steck 2018). */
function divergence(target: Map<string, number>, picked: Map<string, number>): number {
  let sum = 0;
  for (const [genre, p] of target) {
    if (p <= 0) continue;
    const q = (1 - CALIBRATION_ALPHA) * (picked.get(genre) ?? 0) + CALIBRATION_ALPHA * p;
    sum += p * Math.log(p / q);
  }
  return sum;
}

/**
 * Greedy rail selection: each step takes the title with the best faded score (repeats of a seed,
 * franchise or studio fade) blended with how well the rail then matches the genre mix the viewer
 * likes. Without calibration it is the faded score alone.
 */
function selectDiverse(
  scored: HybridScored[],
  history: HybridHistoryItem[],
  limit: number,
  calibrate: number,
): HybridScored[] {
  const pool = scored.slice(0, SELECTION_POOL);
  const franchise = franchiseKeys(pool.map((row) => row.features));
  const target = calibrate
    ? genreMix(history.map((row) => ({ features: row.features, weight: row.affinity })))
    : new Map<string, number>();
  const maxScore = Math.max(1e-9, ...pool.map((row) => row.rawScore));
  const picked: HybridScored[] = [];
  const seeds = new Map<string, number>();
  const franchises = new Map<string, number>();
  const studios = new Map<string, number>();
  const remaining = new Set(pool);
  const count = (map: Map<string, number>, key: string | undefined): void => {
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  while (picked.length < limit && remaining.size) {
    let best: HybridScored | undefined;
    let bestValue = -Infinity;
    for (const row of remaining) {
      const franchiseKey = franchise.get(itemKey(row.features));
      const studio = studioKey(row.features);
      const faded =
        (row.rawScore / maxScore) *
        (row.seedKey ? fade(SEED_FADE, seeds.get(row.seedKey) ?? 0) : 1) *
        (franchiseKey ? fade(FRANCHISE_FADE, franchises.get(franchiseKey) ?? 0) : 1) *
        (studio ? fade(STUDIO_FADE, studios.get(studio) ?? 0) : 1);
      let value = faded;
      if (calibrate && target.size) {
        const mix = genreMix(
          [...picked, row].map((pick) => ({ features: pick.features, weight: 1 })),
        );
        value = (1 - calibrate) * faded - calibrate * divergence(target, mix);
      }
      if (value > bestValue) {
        best = row;
        bestValue = value;
      }
    }
    if (!best) break;
    remaining.delete(best);
    picked.push(best);
    count(seeds, best.seedKey);
    count(franchises, franchise.get(itemKey(best.features)));
    count(studios, studioKey(best.features));
  }
  return picked;
}

/**
 * Candidate retrieval from the local feature cache by taste (a small on-device stand-in for the
 * retrieval stage of X and YouTube): the cached titles closest to the liked titles, pushed away
 * from disliked ones. No provider requests.
 */
export function tasteRetrieval(
  history: HybridHistoryItem[],
  pool: RecommendationItemFeatures[],
  limit: number,
): RecommendationItemFeatures[] {
  if (!pool.length || !history.length) return [];
  const space = new ContentSpace([...history.map((row) => row.features), ...pool]);
  const profile: Vector = new Map();
  for (const row of history)
    addScaled(
      profile,
      space.vector(row.features),
      row.affinity > 0 ? row.affinity : row.affinity * 0.5,
    );
  const known = new Set(history.map((row) => itemKey(row.features)));
  return pool
    .filter((item) => !known.has(itemKey(item)))
    .map((item) => ({ item, similarity: dot(profile, space.vector(item)) }))
    .filter(({ similarity }) => similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || compareItems(a.item, b.item))
    .slice(0, limit)
    .map(({ item }) => item);
}

/** A tag counts toward hiding only when it is central to the title (AniList rank). */
const HIDDEN_TAG_MIN_RANK = 50;

/** Genres or tags the viewer chose to hide (Settings); `hidden` holds lower-cased names. */
export function isHidden(item: RecommendationItemFeatures, hidden: ReadonlySet<string>): boolean {
  if (!hidden.size) return false;
  return (
    item.genres.some((genre) => hidden.has(genre.toLocaleLowerCase())) ||
    item.tags.some(
      (tag) => (tag.rank ?? 100) >= HIDDEN_TAG_MIN_RANK && hidden.has(tag.name.toLocaleLowerCase()),
    )
  );
}
