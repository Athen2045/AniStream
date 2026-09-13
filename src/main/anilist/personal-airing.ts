import type { PersonalAiringUpdate } from "../../shared/personal-library";

const PERSONAL_AIRING_QUERY = `
  query AniStreamPersonalAiring($ids: [Int], $since: Int!) {
    Page(page: 1, perPage: 50) {
      airingSchedules(mediaId_in: $ids, airingAt_greater: $since, notYetAired: false, sort: TIME_DESC) {
        mediaId episode airingAt
      }
    }
  }
`;

/** One bounded query; no catalog traversal or inference from a future schedule. */
export async function loadPersonalAiring(
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  mediaIds: number[],
  now = Date.now(),
): Promise<PersonalAiringUpdate[]> {
  const ids = [
    ...new Set(mediaIds.filter((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)),
  ]
    .slice(0, 24)
    .sort((a, b) => a - b);
  if (!ids.length) return [];
  const since = Math.floor(now / 1000) - 30 * 86400;
  const payload = await request(PERSONAL_AIRING_QUERY, { ids, since });
  const page = record(record(payload)?.Page);
  if (!Array.isArray(page?.airingSchedules))
    throw new Error("AniList returned invalid personal airing data.");
  const latest = new Map<number, PersonalAiringUpdate>();
  for (const value of page.airingSchedules.slice(0, 50)) {
    const row = record(value);
    if (
      !row ||
      typeof row.mediaId !== "number" ||
      !ids.includes(row.mediaId) ||
      typeof row.episode !== "number" ||
      !Number.isInteger(row.episode) ||
      row.episode < 1 ||
      typeof row.airingAt !== "number" ||
      !Number.isInteger(row.airingAt) ||
      row.airingAt <= since ||
      row.airingAt > now / 1000
    )
      continue;
    if ((latest.get(row.mediaId)?.episode ?? 0) < row.episode)
      latest.set(row.mediaId, {
        aniListId: row.mediaId,
        episode: row.episode,
        airedAt: row.airingAt,
      });
  }
  return [...latest.values()];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
