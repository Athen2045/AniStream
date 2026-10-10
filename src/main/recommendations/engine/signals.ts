import type { RecommendationItemFeatures } from "../../../shared/recommendations";
import { compareItems, DAY_MS, itemKey } from "./content";
import type { HybridScored, ScoreAdjustments } from "./types";

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
