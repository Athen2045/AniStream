import { X } from "lucide-react";
import {
  COUNTRY_LABELS,
  FILTER_YEAR_MIN,
  FORMAT_LABELS,
  MEDIA_SEASONS,
  MEDIA_STATUSES,
  ORIGIN_COUNTRIES,
  SEASON_LABELS,
  STATUS_LABELS,
  filterYearMax,
  formatsFor,
  type AniListFilterOptions,
} from "../../shared/anilist-filters";
import type { AniListMediaType } from "../../shared/contracts";
import {
  DEFAULT_SORT,
  SORT_LABELS,
  activeFilterCount,
  emptyFilters,
  type CatalogFilterState,
  type CatalogSort,
} from "./catalog-filters";
import { Select, type SelectOption } from "./Select";

const ANY = "";
const SCORE_STEPS = [50, 60, 70, 80, 90] as const;

type FilterField = Exclude<keyof CatalogFilterState, "sort">;

/**
 * One row of pill dropdowns for a Search section. Each pill reads as its field name until
 * chosen. Every control maps to an exact AniList `Page.media` argument; nothing filters locally.
 */
export function CatalogFilterBar({
  type,
  value,
  options,
  onChange,
}: {
  type: AniListMediaType;
  value: CatalogFilterState;
  /** Genre and tag vocabularies; undefined while loading or when AniList is unreachable. */
  options?: AniListFilterOptions;
  onChange: (next: CatalogFilterState) => void;
}): React.JSX.Element {
  const set = (key: FilterField, next: string): void => {
    const updated: CatalogFilterState = { ...value };
    if (!next) delete updated[key];
    else if (key === "year" || key === "minScore") updated[key] = Number(next);
    else Object.assign(updated, { [key]: next });
    // A season means little without its year; start from this year when none is chosen.
    if (key === "season" && next && updated.year === undefined)
      updated.year = new Date().getFullYear();
    onChange(updated);
  };

  const pill = (
    key: FilterField,
    placeholder: string,
    choices: SelectOption<string>[],
    disabled = false,
  ): React.JSX.Element => {
    const current = value[key];
    return (
      <Select
        key={key}
        ariaLabel={placeholder}
        className={`filter-pill${current !== undefined ? " is-set" : ""}`}
        value={current === undefined ? ANY : String(current)}
        disabled={disabled}
        options={[{ value: ANY, label: placeholder }, ...choices]}
        onChange={(next) => set(key, next)}
      />
    );
  };

  const years: SelectOption<string>[] = [];
  for (let year = filterYearMax(); year >= FILTER_YEAR_MIN; year -= 1)
    years.push({ value: String(year), label: String(year) });

  const changed = activeFilterCount(value) > 0 || value.sort !== DEFAULT_SORT;

  return (
    <div className="catalog-filters" role="group" aria-label="Filters">
      {pill(
        "genre",
        "Genre",
        (options?.genres ?? []).map((genre) => ({ value: genre, label: genre })),
        !options?.genres.length,
      )}
      {pill(
        "format",
        "Format",
        formatsFor(type).map((format) => ({ value: format, label: FORMAT_LABELS[format] })),
      )}
      {pill(
        "status",
        "Status",
        MEDIA_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
      )}
      {type === "ANIME"
        ? pill(
            "season",
            "Season",
            MEDIA_SEASONS.map((season) => ({ value: season, label: SEASON_LABELS[season] })),
          )
        : null}
      {pill("year", "Year", years)}
      {pill(
        "country",
        "Country",
        ORIGIN_COUNTRIES.map((country) => ({ value: country, label: COUNTRY_LABELS[country] })),
      )}
      {pill(
        "tag",
        "Tag",
        (options?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name })),
        !options?.tags.length,
      )}
      {pill(
        "minScore",
        "Score",
        SCORE_STEPS.map((score) => ({ value: String(score), label: `Score ${score / 10}+` })),
      )}
      <Select<CatalogSort>
        ariaLabel="Sort"
        className={`filter-pill${value.sort !== DEFAULT_SORT ? " is-set" : ""}`}
        value={value.sort}
        options={(Object.keys(SORT_LABELS) as CatalogSort[]).map((sort) => ({
          value: sort,
          label: SORT_LABELS[sort],
        }))}
        onChange={(next) => onChange({ ...value, sort: next })}
      />
      {changed ? (
        <button
          type="button"
          className="catalog-filters-clear"
          onClick={() => onChange(emptyFilters())}
        >
          <X size={14} aria-hidden="true" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
