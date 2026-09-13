import type { AniListMedia } from "../../shared/contracts";
import { normalizeMedia } from "./normalize";

const QUERY = `query AniStreamRecommendationSeeds($ids: [Int!]!) {
  Page(page: 1, perPage: 24) { media(id_in: $ids) {
    id type title { userPreferred english romaji } coverImage { large }
    format status episodes chapters volumes genres averageScore siteUrl
  } }
}`;

export async function loadRecommendationSeeds(
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  ids: number[],
): Promise<AniListMedia[]> {
  const exactIds = [
    ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)),
  ].slice(0, 24);
  if (!exactIds.length) return [];
  const response = await request(QUERY, { ids: exactIds });
  if (!isRecord(response) || !isRecord(response.Page) || !Array.isArray(response.Page.media))
    throw new Error("AniList returned invalid recommendation seed data.");
  const seen = new Set<number>();
  return response.Page.media.slice(0, 24).flatMap((value) => {
    if (
      !isRecord(value) ||
      (value.type !== "ANIME" && value.type !== "MANGA") ||
      typeof value.id !== "number" ||
      !exactIds.includes(value.id) ||
      seen.has(value.id)
    )
      return [];
    const normalized = normalizeMedia(value, value.type);
    seen.add(normalized.id);
    return [normalized];
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
