import {
  COUNTRY_LABELS,
  FORMAT_LABELS,
  SEASON_LABELS,
  STATUS_LABELS,
} from "../../shared/anilist-filters";
import {
  MORE_LANGUAGES,
  MORE_SORT_LABELS,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import { DEFAULT_SORT, SORT_LABELS, type CatalogFilterState } from "./catalog-filters";
import { DEFAULT_MORE_SORT } from "./more-filter-state";

/** An applied filter shown as a removable chip under the search field. */
export interface FilterChip {
  key: string;
  label: string;
  remove: () => void;
}

/** Anime/Manga filters in use, each removable on its own (sort returns to the default). */
export function catalogFilterChips(
  filters: CatalogFilterState,
  update: (next: CatalogFilterState) => void,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const without = (key: keyof CatalogFilterState) => () => {
    const next = { ...filters };
    delete next[key];
    update(next);
  };
  if (filters.genre) chips.push({ key: "genre", label: filters.genre, remove: without("genre") });
  if (filters.format)
    chips.push({ key: "format", label: FORMAT_LABELS[filters.format], remove: without("format") });
  if (filters.status)
    chips.push({ key: "status", label: STATUS_LABELS[filters.status], remove: without("status") });
  if (filters.season)
    chips.push({ key: "season", label: SEASON_LABELS[filters.season], remove: without("season") });
  if (filters.year !== undefined)
    chips.push({ key: "year", label: String(filters.year), remove: without("year") });
  if (filters.country)
    chips.push({
      key: "country",
      label: COUNTRY_LABELS[filters.country],
      remove: without("country"),
    });
  if (filters.tag) chips.push({ key: "tag", label: filters.tag, remove: without("tag") });
  if (filters.minScore !== undefined)
    chips.push({
      key: "score",
      label: `Score ${filters.minScore / 10}+`,
      remove: without("minScore"),
    });
  if (filters.sort !== DEFAULT_SORT)
    chips.push({
      key: "sort",
      label: SORT_LABELS[filters.sort],
      remove: () => update({ ...filters, sort: DEFAULT_SORT }),
    });
  return chips;
}

/** Movies & TV filters in use, each removable on its own (sort returns to the default). */
export function moreFilterChips(
  filters: MoreBrowseFilters,
  update: (next: MoreBrowseFilters) => void,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const without = (key: keyof MoreBrowseFilters) => () => {
    const next = { ...filters };
    delete next[key];
    update(next);
  };
  if (filters.type)
    chips.push({
      key: "type",
      label: filters.type === "MOVIE" ? "Movies" : "Shows",
      remove: without("type"),
    });
  if (filters.genre) chips.push({ key: "genre", label: filters.genre, remove: without("genre") });
  if (filters.language)
    chips.push({
      key: "language",
      label: MORE_LANGUAGES.find((row) => row.code === filters.language)?.label ?? filters.language,
      remove: without("language"),
    });
  if (filters.year !== undefined)
    chips.push({ key: "year", label: String(filters.year), remove: without("year") });
  if (filters.minScore !== undefined)
    chips.push({ key: "score", label: `Score ${filters.minScore}+`, remove: without("minScore") });
  if (filters.sort !== DEFAULT_MORE_SORT)
    chips.push({
      key: "sort",
      label: MORE_SORT_LABELS[filters.sort as MoreSort],
      remove: () => update({ ...filters, sort: DEFAULT_MORE_SORT }),
    });
  return chips;
}
