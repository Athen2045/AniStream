import { X } from "lucide-react";
import type { MoreMediaType } from "../../shared/contracts";
import {
  MORE_GENRES,
  MORE_LANGUAGES,
  MORE_SCORE_STEPS,
  MORE_SORT_LABELS,
  MORE_YEAR_MIN,
  moreFilterCount,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import { Select, type SelectOption } from "./Select";

const ANY = "";
export const DEFAULT_MORE_SORT: MoreSort = "popular";

export function emptyMoreFilters(): MoreBrowseFilters {
  return { sort: DEFAULT_MORE_SORT };
}

type FilterField = Exclude<keyof MoreBrowseFilters, "sort">;

/**
 * More's row of pill dropdowns, built like the Anime/Manga bar: each pill reads as its field
 * name until chosen. Genres a type lacks (Horror has no TV genre on TMDB) are hidden when that
 * type is picked.
 */
export function MoreFilterBar({
  value,
  onChange,
}: {
  value: MoreBrowseFilters;
  onChange: (next: MoreBrowseFilters) => void;
}): React.JSX.Element {
  const set = (key: FilterField, next: string): void => {
    const updated: MoreBrowseFilters = { ...value };
    if (!next) delete updated[key];
    else if (key === "year" || key === "minScore") updated[key] = Number(next);
    else if (key === "type") updated.type = next as MoreMediaType;
    else updated[key] = next;
    // A genre the chosen type does not have would match nothing; drop it.
    if (key === "type" && updated.genre) {
      const genre = MORE_GENRES.find((row) => row.name === updated.genre);
      if (genre && (next === "MOVIE" ? !genre.movie : next === "TV" ? !genre.tv : false))
        delete updated.genre;
    }
    onChange(updated);
  };

  const pill = (
    key: FilterField,
    placeholder: string,
    choices: SelectOption<string>[],
  ): React.JSX.Element => {
    const current = value[key];
    return (
      <Select
        key={key}
        ariaLabel={placeholder}
        className={`filter-pill${current !== undefined ? " is-set" : ""}`}
        value={current === undefined ? ANY : String(current)}
        options={[{ value: ANY, label: placeholder }, ...choices]}
        onChange={(next) => set(key, next)}
      />
    );
  };

  const years: SelectOption<string>[] = [];
  for (let year = new Date().getFullYear() + 1; year >= MORE_YEAR_MIN; year -= 1)
    years.push({ value: String(year), label: String(year) });
  const genres = MORE_GENRES.filter((genre) =>
    value.type === "MOVIE" ? genre.movie : value.type === "TV" ? genre.tv : true,
  );
  const changed = moreFilterCount(value) > 0 || value.sort !== DEFAULT_MORE_SORT;

  return (
    <div className="catalog-filters" role="group" aria-label="Filters">
      {pill("type", "Type", [
        { value: "MOVIE", label: "Movies" },
        { value: "TV", label: "Shows" },
      ])}
      {pill(
        "genre",
        "Genre",
        genres.map((genre) => ({ value: genre.name, label: genre.name })),
      )}
      {pill(
        "language",
        "Language",
        MORE_LANGUAGES.map((language) => ({ value: language.code, label: language.label })),
      )}
      {pill("year", "Year", years)}
      {pill(
        "minScore",
        "Score",
        MORE_SCORE_STEPS.map((score) => ({ value: String(score), label: `Score ${score}+` })),
      )}
      <Select<MoreSort>
        ariaLabel="Sort"
        className={`filter-pill${value.sort !== DEFAULT_MORE_SORT ? " is-set" : ""}`}
        value={value.sort}
        options={(Object.keys(MORE_SORT_LABELS) as MoreSort[]).map((sort) => ({
          value: sort,
          label: MORE_SORT_LABELS[sort],
        }))}
        onChange={(next) => onChange({ ...value, sort: next })}
      />
      {changed ? (
        <button
          type="button"
          className="catalog-filters-clear"
          onClick={() => onChange(emptyMoreFilters())}
        >
          <X size={14} aria-hidden="true" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
