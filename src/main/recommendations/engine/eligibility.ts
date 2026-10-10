/** What a viewer can start: same-work, unstarted-prequel and hidden-genre filters, and the
 * first-season redirect. */
import type {
  RecommendationEdge,
  RecommendationItemFeatures,
  RecommendationRelation,
} from "../../../shared/recommendations";
import { edgeKey, itemKey } from "./content";
import type { HybridHistoryItem } from "./types";

const CROSS_SECTION = new Set<RecommendationRelation["relationType"]>([
  "ADAPTATION",
  "SOURCE",
  "ALTERNATIVE",
]);

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
