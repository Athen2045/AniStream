import type Database from "better-sqlite3";
import type {
  RecommendationEvent,
  RecommendationImpression,
  RecommendationItemFeatures,
  RecommendationResult,
} from "../../shared/recommendations";

export interface RecommendationRepository {
  recordRecommendationEvent(event: RecommendationEvent): void;
  listRecommendationEvents(limit?: number): RecommendationEvent[];
  upsertRecommendationItemFeatures(features: RecommendationItemFeatures): void;
  listRecommendationItemFeatures(ids?: readonly number[]): RecommendationItemFeatures[];
  recordRecommendationImpressions(
    requestId: string,
    results: RecommendationResult[],
    shownAt?: number,
  ): void;
  listRecommendationImpressions(requestId: string): RecommendationImpression[];
}

export function createRecommendationRepository(
  database: Database.Database,
): RecommendationRepository {
  const insertEvent = database.prepare(`
    INSERT INTO recommendation_events (anilist_id, media_type, occurred_at, event_type, source, value)
    VALUES (@anilistId, @mediaType, @occurredAt, @eventType, @source, @value)
  `);
  const readEvents = database.prepare<[number], RecommendationEventRow>(`
    SELECT anilist_id, media_type, occurred_at, event_type, source, value
    FROM recommendation_events ORDER BY occurred_at DESC, id DESC LIMIT ?
  `);
  const upsertFeatures = database.prepare(`
    INSERT INTO recommendation_item_features (
      anilist_id, media_type, mal_id, normalized_title, cover_url, features_json, updated_at
    ) VALUES (@anilistId, @mediaType, @malId, @normalizedTitle, @coverUrl, @featuresJson, @updatedAt)
    ON CONFLICT(anilist_id) DO UPDATE SET
      media_type = excluded.media_type,
      mal_id = excluded.mal_id,
      normalized_title = excluded.normalized_title,
      cover_url = excluded.cover_url,
      features_json = excluded.features_json,
      updated_at = excluded.updated_at
  `);
  const readFeatures = database.prepare<[], RecommendationFeatureRow>(`
    SELECT anilist_id, media_type, mal_id, normalized_title, cover_url, features_json, updated_at
    FROM recommendation_item_features ORDER BY anilist_id
  `);
  const insertImpression = database.prepare(`
    INSERT INTO recommendation_impressions (
      request_id, anilist_id, media_type, position, score, result_json, shown_at
    ) VALUES (@requestId, @anilistId, @mediaType, @position, @score, @resultJson, @shownAt)
  `);
  const readImpressions = database.prepare<[string], RecommendationImpressionRow>(`
    SELECT request_id, anilist_id, media_type, position, score, result_json, shown_at
    FROM recommendation_impressions WHERE request_id = ? ORDER BY position
  `);

  return {
    recordRecommendationEvent(event) {
      validateId(event.anilistId);
      insertEvent.run({ ...event, value: event.value ?? null });
    },
    listRecommendationEvents(limit = 500) {
      return readEvents.all(clampLimit(limit)).map((row) => ({
        anilistId: row.anilist_id,
        mediaType: row.media_type,
        occurredAt: row.occurred_at,
        eventType: row.event_type,
        source: row.source,
        ...(row.value === null ? {} : { value: row.value }),
      }));
    },
    upsertRecommendationItemFeatures(features) {
      validateId(features.anilistId);
      const serialized = JSON.stringify({
        titleTokens: features.titleTokens,
        synonyms: features.synonyms,
        genres: features.genres,
        tags: features.tags,
        creators: features.creators,
        averageScore: features.averageScore,
        malScore: features.malScore,
        popularity: features.popularity,
        status: features.status,
      });
      if (serialized.length > 200_000)
        throw new Error("Recommendation feature snapshot is too large.");
      upsertFeatures.run({
        anilistId: features.anilistId,
        mediaType: features.mediaType,
        malId: features.malId ?? null,
        normalizedTitle: features.normalizedTitle,
        coverUrl: features.coverUrl ?? null,
        featuresJson: serialized,
        updatedAt: features.updatedAt,
      });
    },
    listRecommendationItemFeatures(ids) {
      const allowed = ids ? new Set(ids) : undefined;
      return readFeatures.all().flatMap((row) => {
        if (allowed && !allowed.has(row.anilist_id)) return [];
        const parsed = parseFeatureJson(row.features_json);
        return parsed
          ? [
              {
                anilistId: row.anilist_id,
                mediaType: row.media_type,
                malId: row.mal_id ?? undefined,
                normalizedTitle: row.normalized_title,
                coverUrl: row.cover_url ?? undefined,
                ...parsed,
                updatedAt: row.updated_at,
              },
            ]
          : [];
      });
    },
    recordRecommendationImpressions(requestId, results, shownAt = Date.now()) {
      if (!requestId.trim() || requestId.length > 120)
        throw new Error("Invalid recommendation request ID.");
      const writeMany = database.transaction(() => {
        results.slice(0, 10).forEach((result, position) => {
          insertImpression.run({
            requestId,
            anilistId: result.anilistId,
            mediaType: result.mediaType,
            position,
            score: result.score,
            resultJson: JSON.stringify(result),
            shownAt,
          });
        });
      });
      writeMany();
    },
    listRecommendationImpressions(requestId) {
      return readImpressions.all(requestId).map((row) => ({
        ...parseResult(row.result_json),
        requestId: row.request_id,
        position: row.position,
        shownAt: row.shown_at,
      }));
    },
  };
}

interface RecommendationEventRow {
  anilist_id: number;
  media_type: RecommendationEvent["mediaType"];
  occurred_at: number;
  event_type: RecommendationEvent["eventType"];
  source: RecommendationEvent["source"];
  value: number | null;
}

interface RecommendationFeatureRow {
  anilist_id: number;
  media_type: RecommendationItemFeatures["mediaType"];
  mal_id: number | null;
  normalized_title: string;
  cover_url: string | null;
  features_json: string;
  updated_at: number;
}

interface RecommendationImpressionRow {
  request_id: string;
  anilist_id: number;
  media_type: RecommendationResult["mediaType"];
  position: number;
  score: number;
  result_json: string;
  shown_at: number;
}

type FeatureJson = Pick<
  RecommendationItemFeatures,
  | "titleTokens"
  | "synonyms"
  | "genres"
  | "tags"
  | "creators"
  | "averageScore"
  | "malScore"
  | "popularity"
  | "status"
>;

function parseFeatureJson(value: string): FeatureJson | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.titleTokens) ||
      !Array.isArray(parsed.genres) ||
      !Array.isArray(parsed.tags) ||
      !Array.isArray(parsed.creators)
    )
      return undefined;
    return parsed as FeatureJson;
  } catch {
    return undefined;
  }
}

function parseResult(value: string): RecommendationResult {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.anilistId !== "number" ||
    typeof parsed.title !== "string" ||
    typeof parsed.score !== "number" ||
    !Array.isArray(parsed.reasonCodes)
  )
    throw new Error("Stored recommendation result is invalid.");
  return parsed as unknown as RecommendationResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid AniList recommendation ID.");
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(1_000, Math.floor(limit)));
}
