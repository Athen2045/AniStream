import type { MoreBrowseFilters, MoreSort } from "../../shared/more-filters";

export const DEFAULT_MORE_SORT: MoreSort = "popular";

export function emptyMoreFilters(): MoreBrowseFilters {
  return { sort: DEFAULT_MORE_SORT };
}
