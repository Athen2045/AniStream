import { FILTER_KEYS, type AniListBrowseFilters } from "../../shared/anilist-filters";
import type { AniListMediaType, BrowseAniListInput } from "../../shared/contracts";

export type CatalogSort = NonNullable<BrowseAniListInput["sort"]>;

/** What the Search page's filter drawer holds for one section. */
export interface CatalogFilterState extends AniListBrowseFilters {
  genre?: string;
  sort: CatalogSort;
}

export const DEFAULT_SORT: CatalogSort = "POPULARITY_DESC";

export const SORT_LABELS: Record<CatalogSort, string> = {
  POPULARITY_DESC: "Most popular",
  TRENDING_DESC: "Trending now",
  SCORE_DESC: "Highest rated",
  START_DATE_DESC: "Newest",
};

export function emptyFilters(): CatalogFilterState {
  return { sort: DEFAULT_SORT };
}

/** Filters that narrow results; sort alone only reorders them. */
export function activeFilterCount(state: CatalogFilterState): number {
  return (state.genre ? 1 : 0) + FILTER_KEYS.filter((key) => state[key] !== undefined).length;
}

export function browseInput(
  type: AniListMediaType,
  page: number,
  perPage: number,
  query: string,
  state: CatalogFilterState,
): BrowseAniListInput {
  const input: BrowseAniListInput = { type, page, perPage, sort: state.sort };
  if (query) input.query = query;
  if (state.genre) input.genre = state.genre;
  for (const key of FILTER_KEYS) {
    if (state[key] !== undefined) Object.assign(input, { [key]: state[key] });
  }
  return input;
}

/** A stable key so a results set is only shown for the filters that produced it. */
export function filterKey(state: CatalogFilterState): string {
  return JSON.stringify([
    state.sort,
    state.genre ?? "",
    ...FILTER_KEYS.map((key) => state[key] ?? ""),
  ]);
}
