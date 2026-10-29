import type { MoreBrowseFilters } from "../../shared/more-filters";
import { emptyFilters, type CatalogFilterState } from "./catalog-filters";
import { emptyMoreFilters } from "./more-filter-state";
import type { SearchScope } from "./search-queries";

/** The query in each section's field, so returning from a title shows the same search. */
const queryByScope: Record<SearchScope, string> = { ANIME: "", MANGA: "", MORE: "" };
/** Filters are remembered per section for this app session. */
const filtersByScope: Record<"ANIME" | "MANGA", CatalogFilterState> = {
  ANIME: emptyFilters(),
  MANGA: emptyFilters(),
};
let moreFiltersState: MoreBrowseFilters = emptyMoreFilters();

export function rememberedQuery(scope: SearchScope): string {
  return queryByScope[scope];
}
export function keepQuery(scope: SearchScope, query: string): void {
  queryByScope[scope] = query;
}
export function rememberedFilters(scope: "ANIME" | "MANGA"): CatalogFilterState {
  return filtersByScope[scope];
}
export function keepFilters(scope: "ANIME" | "MANGA", filters: CatalogFilterState): void {
  filtersByScope[scope] = filters;
}
export function rememberedMoreFilters(): MoreBrowseFilters {
  return moreFiltersState;
}
export function keepMoreFilters(filters: MoreBrowseFilters): void {
  moreFiltersState = filters;
}

/** Makes the next Search page in `scope` open on one genre (a Genre row's View all). */
export function presetSearchGenre(scope: SearchScope, genre: string): void {
  keepQuery(scope, "");
  if (scope === "MORE") keepMoreFilters({ ...emptyMoreFilters(), genre });
  else keepFilters(scope, { ...emptyFilters(), genre });
}
