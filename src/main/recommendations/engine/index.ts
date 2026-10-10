/**
 * AniStream's recommendation engine: pure functions from viewer history and candidate features to
 * ranked rails and rows. No I/O, no Electron, no database: the feed services fetch and persist,
 * the engine only decides. Pipeline, in the order the services call it:
 *
 *   evidence     viewer activity → weighted history (affinities)
 *   retrieval    extra candidates from the local feature cache, by taste
 *   eligibility  drop what the viewer knows or cannot start; first-season redirect; hidden genres
 *   rank         graph edges + content similarity + priors → raw scores
 *   signals      ignored-pick fade, freshness, continuation boost
 *   picks        rail selection (soft diversity + calibration from `diversity`) and card reasons
 *   rows         "Because you watched X" and "Because you like <theme>" rows
 */
export {
  discoveryEvidence,
  historyAffinities,
  recommendationFeatures,
  type HistoryAffinity,
} from "./evidence";
export { itemKey } from "./content";
export { tasteRetrieval } from "./retrieval";
export { eligibilityFilter, firstSeason, isHidden, redirectEdges } from "./eligibility";
export { rankHybrid } from "./rank";
export { adjustScores } from "./signals";
export { franchiseKeys } from "./diversity";
export { continuationPicks, pickHybrid, selectHybrid, toAniListResults } from "./picks";
export {
  buildSeedRows,
  buildThemeRow,
  rankThemes,
  rowStrength,
  seedRowsHybrid,
  themeRowHybrid,
} from "./rows";
export type {
  HybridHistoryItem,
  HybridPick,
  HybridRankInput,
  HybridScored,
  HybridSeedRow,
  HybridTheme,
  HybridThemeRow,
  PickOptions,
  ScoreAdjustments,
  SeedRowOptions,
} from "./types";
