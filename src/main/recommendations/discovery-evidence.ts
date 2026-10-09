import type { AniListDashboard, AniListEntry, AniListMedia } from "../../shared/contracts";
import type { LocalActivity } from "../../shared/activity";
import type { RecommendationEvent, RecommendationItemFeatures } from "../../shared/recommendations";

/** One history title and how much the viewer appears to like it, in [-1, 1]. */
export interface HistoryAffinity {
  anilistId: number;
  mediaType: AniListMedia["type"];
  affinity: number;
  occurredAt: number;
}

export function discoveryEvidence(
  activity: LocalActivity[],
  dashboard?: AniListDashboard,
): {
  events: RecommendationEvent[];
  media: AniListMedia[];
  excluded: Set<number>;
  history: HistoryAffinity[];
  historyMedia: AniListMedia[];
  /** Titles actually started (any list status but Planning, or local progress). */
  watched: Set<number>;
} {
  const media = new Map<number, AniListMedia>();
  const evidence = new Map<number, RecommendationEvent>();
  const ratings: RecommendationEvent[] = [];
  const excluded = new Set<number>();
  const watched = new Set<number>();
  for (const group of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])]) {
    for (const entry of group.entries) {
      excluded.add(entry.media.id);
      if (entry.status !== "PLANNING") watched.add(entry.media.id);
      media.set(entry.media.id, entry.media);
      if (entry.progress > 0 || entry.status === "COMPLETED")
        evidence.set(entry.media.id, {
          anilistId: entry.media.id,
          mediaType: entry.media.type,
          occurredAt: entry.updatedAt * 1000,
          eventType: entry.status === "COMPLETED" ? "completed" : "progressed",
          source: "profile",
        });
      if (entry.score > 0 && !ratings.some((row) => row.anilistId === entry.media.id))
        ratings.push({
          anilistId: entry.media.id,
          mediaType: entry.media.type,
          occurredAt: entry.updatedAt * 1000,
          eventType: "rated",
          value: entry.score,
          source: "profile",
        });
    }
  }
  for (const local of activity) {
    excluded.add(local.media.id);
    watched.add(local.media.id);
    if (!media.has(local.media.id)) media.set(local.media.id, local.media);
    const occurredAt = Date.parse(local.updatedAt);
    if ((evidence.get(local.media.id)?.occurredAt ?? 0) >= occurredAt) continue;
    evidence.set(local.media.id, {
      anilistId: local.media.id,
      mediaType: local.media.type,
      occurredAt,
      eventType: local.state === "completed" ? "completed" : "progressed",
      source: local.media.type === "ANIME" ? "player" : "reader",
    });
  }
  const events = [...evidence.values()].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 24);
  const ids = new Set(events.map((event) => event.anilistId));
  const history = historyAffinities(activity, dashboard);
  const historyIds = new Set(history.map((row) => row.anilistId));
  return {
    events: [...events, ...ratings.filter((row) => ids.has(row.anilistId))],
    media: [...media.values()].filter((row) => ids.has(row.id)),
    excluded,
    history,
    historyMedia: [...media.values()].filter((row) => historyIds.has(row.id)),
    watched,
  };
}

/**
 * Per-title affinity from the whole library: scores relative to the viewer's own mean, else list
 * status (dropped is negative, paused neutral, planning is intent only and ignored), plus local
 * playback/reading progress for titles the tracker does not know.
 */
export function historyAffinities(
  activity: LocalActivity[],
  dashboard?: AniListDashboard,
): HistoryAffinity[] {
  const entries = new Map<number, AniListEntry>();
  for (const group of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])])
    for (const entry of group.entries)
      if (!entries.has(entry.media.id)) entries.set(entry.media.id, entry);
  const scored = [...entries.values()].filter((entry) => entry.score > 0);
  const mean = scored.length
    ? scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length
    : 7;
  const history = new Map<number, HistoryAffinity>();
  for (const entry of entries.values()) {
    const affinity = entryAffinity(entry, mean);
    if (affinity === undefined) continue;
    history.set(entry.media.id, {
      anilistId: entry.media.id,
      mediaType: entry.media.type,
      affinity,
      occurredAt: entry.updatedAt * 1000,
    });
  }
  for (const local of activity) {
    const occurredAt = Date.parse(local.updatedAt);
    const known = history.get(local.media.id);
    if (known) {
      known.occurredAt = Math.max(known.occurredAt, Number.isFinite(occurredAt) ? occurredAt : 0);
      continue;
    }
    history.set(local.media.id, {
      anilistId: local.media.id,
      mediaType: local.media.type,
      affinity: local.state === "completed" ? 0.5 : 0.35,
      occurredAt: Number.isFinite(occurredAt) ? occurredAt : 0,
    });
  }
  return [...history.values()].filter((row) => row.affinity !== 0);
}

function entryAffinity(entry: AniListEntry, mean: number): number | undefined {
  if (entry.status === "PLANNING") return undefined;
  let value: number;
  if (entry.score > 0) value = Math.max(-1, Math.min(1, (entry.score - (mean - 1)) / 3));
  else if (entry.status === "DROPPED") value = -0.6;
  else if (entry.status === "PAUSED") value = 0;
  else if (entry.status === "COMPLETED" || entry.status === "REPEATING") value = 0.5;
  else value = entry.progress > 0 ? 0.35 : 0;
  if (entry.repeat > 0) value = Math.min(1, value + 0.3);
  if (entry.status === "DROPPED") value = Math.min(value, -0.3);
  return value;
}

export function recommendationFeatures(
  media: AniListMedia,
  now: number,
): RecommendationItemFeatures {
  return {
    anilistId: media.id,
    mediaType: media.type,
    normalizedTitle: media.title,
    coverUrl: media.coverUrl,
    genres: media.genres ?? [],
    titleTokens: [],
    synonyms: [],
    tags: [],
    creators: [],
    averageScore: media.averageScore,
    status: media.status,
    updatedAt: now,
    popularity:
      "popularity" in media && typeof media.popularity === "number" ? media.popularity : undefined,
  };
}
