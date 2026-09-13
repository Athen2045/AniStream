import type { AniListDashboard, AniListMedia } from "../../shared/contracts";
import type { LocalActivity } from "../../shared/activity";
import type { RecommendationEvent, RecommendationItemFeatures } from "../../shared/recommendations";

export function discoveryEvidence(
  activity: LocalActivity[],
  dashboard?: AniListDashboard,
): { events: RecommendationEvent[]; media: AniListMedia[]; excluded: Set<number> } {
  const media = new Map<number, AniListMedia>();
  const evidence = new Map<number, RecommendationEvent>();
  const ratings: RecommendationEvent[] = [];
  const excluded = new Set<number>();
  for (const group of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])]) {
    for (const entry of group.entries) {
      excluded.add(entry.media.id);
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
  return {
    events: [...events, ...ratings.filter((row) => ids.has(row.anilistId))],
    media: [...media.values()].filter((row) => ids.has(row.id)),
    excluded,
  };
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
