import type {
  RecommendationCandidate,
  RecommendationEvent,
  RecommendationItemFeatures,
} from "../../shared/recommendations";

const titles: Array<[number, "ANIME" | "MANGA", string, string, string]> = [
  [1001, "ANIME", "Psycho Signal", "Psychological", "Studio North"],
  [1002, "MANGA", "Glass City", "Psychological", "A. Author"],
  [1003, "ANIME", "Night Archive", "Mystery", "Studio North"],
  [1004, "MANGA", "Orbit Letters", "Drama", "M. Writer"],
  [1005, "ANIME", "Neon Summer", "Coming of Age", "Studio Lumen"],
  [1006, "MANGA", "The Quiet Room", "Psychological", "A. Author"],
  [1007, "ANIME", "Rain Protocol", "Thriller", "Studio North"],
  [1008, "MANGA", "Blue Hour", "Drama", "M. Writer"],
  [1009, "ANIME", "Paper Kingdom", "Fantasy", "Studio Lumen"],
  [1010, "MANGA", "Afterimage", "Mystery", "A. Author"],
  [1011, "ANIME", "The Long Weekend", "Romance", "Studio Lumen"],
  [1012, "MANGA", "Signal / Noise", "Psychological", "M. Writer"],
  [1013, "ANIME", "Hollow Atlas", "Mystery", "Studio North"],
];

export const previewFeatures: RecommendationItemFeatures[] = titles.map(
  ([id, mediaType, title, tag, creator], index) => ({
    anilistId: id,
    mediaType,
    normalizedTitle: title,
    titleTokens: title.toLocaleLowerCase().split(/\s+/u),
    synonyms: [],
    genres: [tag === "Psychological" || tag === "Mystery" ? "Drama" : tag],
    tags: [{ id: id + 10_000, name: tag, rank: 70 + (index % 3) * 10 }],
    creators: [{ name: creator, role: mediaType === "ANIME" ? "STUDIO" : "AUTHOR" }],
    averageScore: 76 + (index % 5) * 4,
    malId: id + 50_000,
    malScore: 7.4 + (index % 5) * 0.4,
    popularity: 1_000 + index * 700,
    updatedAt: Date.parse("2026-08-01T00:00:00.000Z") + index * 86_400_000,
  }),
);

export const previewSeedEvents: RecommendationEvent[] = [
  {
    anilistId: 1001,
    mediaType: "ANIME",
    occurredAt: Date.parse("2026-08-10T00:00:00.000Z"),
    eventType: "explored",
    source: "detail",
  },
];

export function previewCandidates(
  features: RecommendationItemFeatures[],
  events: RecommendationEvent[],
): RecommendationCandidate[] {
  const seenIds = new Set(events.map((event) => event.anilistId));
  return features
    .filter((feature) => !seenIds.has(feature.anilistId))
    .map((feature) => ({
      features: feature,
      relationStrength: feature.tags.some((tag) => tag.name === "Psychological") ? 0.75 : 0.2,
      relatedTo: 1001,
    }));
}
