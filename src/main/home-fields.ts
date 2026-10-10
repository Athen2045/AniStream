import type { AniListCatalogPage, BrowseAniListInput, MoreCatalogPage } from "../shared/contracts";
import type { DiscoveryFeed, MoreDiscoveryFeed } from "../shared/discovery";

/**
 * Which home fields keep a saved copy (see `FieldSnapshots`), and what counts as worth saving.
 * Checks are structural only: the copies come from this app's own database.
 */

/** Page 1 of plain AniList Trending; any search, genre or filter loads live. */
export function isTrendingRequest(input: BrowseAniListInput): boolean {
  const { type, page, perPage, sort, ...rest } = input;
  return (
    page === 1 &&
    sort === "TRENDING_DESC" &&
    Boolean(type) &&
    (perPage === undefined || Number.isInteger(perPage)) &&
    Object.values(rest).every((value) => value === undefined)
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasItems = (value: unknown, valid: (item: unknown) => boolean): boolean =>
  isRecord(value) &&
  Array.isArray(value.items) &&
  value.items.length > 0 &&
  value.items.every(valid);

export function isUsableAniListPage(value: unknown): value is AniListCatalogPage {
  return (
    hasItems(value, (item) => isRecord(item) && Number.isInteger(item.id)) &&
    isRecord((value as Record<string, unknown>).pageInfo)
  );
}

export function isUsableMorePage(value: unknown): value is MoreCatalogPage {
  return (
    hasItems(value, (item) => isRecord(item) && Number.isInteger(item.id)) &&
    isRecord((value as Record<string, unknown>).pageInfo)
  );
}

export function isUsableDiscoveryFeed(value: unknown): value is DiscoveryFeed {
  return (
    hasItems(value, (item) => isRecord(item) && Number.isInteger(item.anilistId)) &&
    (value as Record<string, unknown>).status === "ready"
  );
}

export function isUsableMoreFeed(value: unknown): value is MoreDiscoveryFeed {
  return (
    hasItems(value, (row) => isRecord(row) && isRecord(row.item)) &&
    (value as Record<string, unknown>).status === "ready"
  );
}

/** The feed without one dismissed title (main rail and every row); other values pass through. */
export function withoutDiscoveryTitle(value: unknown, anilistId: number): unknown {
  if (!isUsableDiscoveryFeed(value)) return value;
  const keep = (item: { anilistId: number }): boolean => item.anilistId !== anilistId;
  return {
    ...value,
    items: value.items.filter(keep),
    rows: value.rows?.map((row) => ({ ...row, items: row.items.filter(keep) })),
  };
}

export function withoutMoreTitle(value: unknown, type: string, tmdbId: number): unknown {
  if (!isUsableMoreFeed(value)) return value;
  const keep = (row: { item: { type: string; id: number } }): boolean =>
    row.item.type !== type || row.item.id !== tmdbId;
  return {
    ...value,
    items: value.items.filter(keep),
    rows: value.rows?.map((row) => ({ ...row, items: row.items.filter(keep) })),
  };
}
