/** Rail selection, the exploration slot, and reasons shown on each card. */
import type {
  RecommendationReasonCode,
  RecommendationResult,
} from "../../../shared/recommendations";
import {
  clamp,
  creatorKey,
  itemKey,
  MIN_TAG_RANK,
  popularityPrior,
  qualityPrior,
  tagKey,
} from "./content";
import { balanceTypes, selectDiverse } from "./diversity";
import type { HybridHistoryItem, HybridPick, HybridScored, PickOptions } from "./types";

/** Zero-based rail position of the exploration pick (the seventh card). */
const EXPLORE_SLOT = 6;
const EXPLORE_MIN_SCORE = 75;

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

export function toAniListResult(pick: HybridPick): RecommendationResult {
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

export function pickContext(history: HybridHistoryItem[]) {
  return {
    seeds: new Map(history.map((row) => [itemKey(row.features), row.features])),
    liked: tasteSets(history),
  };
}

export function toPick(
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
