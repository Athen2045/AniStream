import type { MoreDetail, MoreMediaType } from "../shared/contracts";
import type { TitleCopies } from "./title-copies";

/** Saved copies older than this are still shown at once, then refreshed in the background. */
export const MORE_DETAIL_REFRESH_MS = 24 * 3_600_000;

interface SavedDetail {
  savedAt: number;
  detail: MoreDetail;
}

export interface MoreDetailSource {
  getDetail(id: number, type: MoreMediaType, priority?: boolean): Promise<MoreDetail>;
}

/**
 * A More title's detail (logo, backdrop, facts) from the copy saved on this device when there is
 * one, so heroes and title pages show their logo at once after the first visit, even right after
 * launch. A copy older than a day is refreshed in the background (normal priority) for next time;
 * without a copy the live request runs, ahead of background work when `priority` is set.
 */
export function createMoreDetailLoader(
  tmdb: MoreDetailSource,
  copies: TitleCopies | undefined,
  now: () => number = Date.now,
): (id: number, type: MoreMediaType, priority?: boolean) => Promise<MoreDetail> {
  const refreshing = new Set<string>();

  const fetchAndSave = async (
    key: string,
    id: number,
    type: MoreMediaType,
    priority: boolean,
  ): Promise<MoreDetail> => {
    const detail = await tmdb.getDetail(id, type, priority);
    try {
      copies?.write(key, id, { savedAt: now(), detail } satisfies SavedDetail);
    } catch {
      // A full or locked database must not cost the viewer the detail itself.
    }
    return detail;
  };

  return async (id, type, priority = false) => {
    const key = `more-detail:${type}:${id}`;
    const saved = readSaved(copies?.read(key));
    if (!saved) return fetchAndSave(key, id, type, priority);
    if (now() - saved.savedAt >= MORE_DETAIL_REFRESH_MS && !refreshing.has(key)) {
      refreshing.add(key);
      void fetchAndSave(key, id, type, false)
        .catch(() => undefined)
        .finally(() => refreshing.delete(key));
    }
    return saved.detail;
  };
}

/** Our own saved rows, still checked: an older or damaged row is simply refetched. */
function readSaved(value: unknown): SavedDetail | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { savedAt, detail } = value as Partial<SavedDetail>;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return undefined;
  if (typeof detail !== "object" || detail === null) return undefined;
  if (typeof detail.title !== "string" || !Array.isArray(detail.recommendations)) return undefined;
  if (!Array.isArray(detail.genres) || !Array.isArray(detail.seasons)) return undefined;
  return { savedAt, detail };
}
