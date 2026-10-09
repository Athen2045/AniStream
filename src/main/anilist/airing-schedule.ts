import type {
  AiringSchedule,
  AiringScheduleEntry,
  AiringScheduleInput,
} from "../../shared/contracts";
import { CATALOG_MEDIA_FIELDS } from "./queries";
import { normalizeCatalogMedia } from "./normalize";

const SCHEDULE_QUERY = `
  query AniStreamAiringSchedule($page: Int!, $start: Int!, $end: Int!, $ids: [Int]) {
    Page(page: $page, perPage: 50) {
      pageInfo {
        hasNextPage
      }
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, mediaId_in: $ids, sort: TIME) {
        episode
        airingAt
        media {
          ...AniStreamCatalogMedia
          isAdult
        }
      }
    }
  }
  ${CATALOG_MEDIA_FIELDS}
`;

/** Longest span one schedule call may cover: a week plus slack for time-zone edges. */
export const MAX_SCHEDULE_SPAN_SECONDS = 8 * 86_400;
/** A list-only call may cover a six-week month grid (plus a daylight-saving hour). */
export const MAX_LIST_SCHEDULE_SPAN_SECONDS = 43 * 86_400;
export const MAX_SCHEDULE_MEDIA_IDS = 200;
// Conservative application policy: a busy week is roughly 150–250 airings. The page budget
// bounds AniList requests per view; an exhausted budget is reported as `partial`.
const ALL_AIRING_PAGE_BUDGET = 6;
const LIST_PAGE_BUDGET = 4;

/** Reads one span of AniList's airing schedule within a fixed page budget; no catalog traversal. */
export async function loadAiringSchedule(
  request: (query: string, variables: Record<string, unknown>) => Promise<unknown>,
  input: AiringScheduleInput,
): Promise<AiringSchedule> {
  const ids = input.mediaIds
    ? [...new Set(input.mediaIds)].sort((a, b) => a - b).slice(0, MAX_SCHEDULE_MEDIA_IDS)
    : undefined;
  if (ids && !ids.length) return { entries: [], partial: false };
  const budget = ids ? LIST_PAGE_BUDGET : ALL_AIRING_PAGE_BUDGET;
  const entries = new Map<string, AiringScheduleEntry>();
  let hasNextPage = true;
  for (let page = 1; hasNextPage && page <= budget; page += 1) {
    const payload = await request(SCHEDULE_QUERY, {
      page,
      // AniList's bounds are exclusive; widen by one second so the span is inclusive.
      start: input.start - 1,
      end: input.end + 1,
      ...(ids ? { ids } : {}),
    });
    const body = record(record(payload)?.Page);
    const rows = body?.airingSchedules;
    if (!body || !Array.isArray(rows)) throw new Error("AniList returned an invalid schedule.");
    hasNextPage = record(body.pageInfo)?.hasNextPage === true;
    for (const value of rows) {
      const row = record(value);
      const episode = row?.episode;
      const airingAt = row?.airingAt;
      if (
        !row ||
        typeof episode !== "number" ||
        !Number.isInteger(episode) ||
        episode < 1 ||
        typeof airingAt !== "number" ||
        !Number.isInteger(airingAt) ||
        airingAt < input.start ||
        airingAt > input.end ||
        record(row.media)?.isAdult === true
      )
        continue;
      try {
        const media = normalizeCatalogMedia(row.media, "ANIME");
        if (ids && !ids.includes(media.id)) continue;
        entries.set(`${media.id}:${episode}`, { media, episode, airingAt });
      } catch {
        // One malformed title must not hide the rest of the week.
      }
    }
  }
  return {
    entries: [...entries.values()].sort(
      (a, b) => a.airingAt - b.airingAt || a.media.title.localeCompare(b.media.title),
    ),
    partial: hasNextPage,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
