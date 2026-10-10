/** "Because you watched X" and "Because you like <theme>" rows. */
import type { DiscoveryRow } from "../../../shared/discovery";
import {
  recommendationSection,
  type RecommendationItemFeatures,
  type RecommendationItemType,
  type RecommendationMediaType,
  type RecommendationSection,
} from "../../../shared/recommendations";
import {
  compareItems,
  ContentSpace,
  dot,
  edgeKey,
  itemKey,
  knownOrigin,
  MIN_TAG_RANK,
  shuffle,
  tagKey,
} from "./content";
import { franchiseKeys, MAX_PER_FRANCHISE_IN_ROW } from "./diversity";
import { pickContext, toAniListResult, toPick } from "./picks";
import type {
  HybridHistoryItem,
  HybridScored,
  HybridSeedRow,
  HybridTheme,
  HybridThemeRow,
  SeedRowOptions,
} from "./types";

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
 * How strong a row is: the mean score of its top six cards (what fits on screen), so rows can be
 * ordered strongest first.
 */
export function rowStrength(items: ReadonlyArray<{ score: number }>): number {
  const top = items.slice(0, 6);
  return top.length ? top.reduce((sum, item) => sum + item.score, 0) / top.length : 0;
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

function mostCommon(values: ReadonlyArray<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  for (const [value, count] of counts) if (!best || count > counts.get(best)!) best = value;
  return best;
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
