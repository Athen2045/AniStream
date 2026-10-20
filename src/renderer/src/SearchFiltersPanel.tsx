import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import type { AniListMediaType, MoreMediaType } from "../../shared/contracts";
import {
  MORE_GENRES,
  MORE_LANGUAGES,
  MORE_SCORE_STEPS,
  MORE_SORT_LABELS,
  MORE_YEAR_MIN,
  type MoreBrowseFilters,
  type MoreSort,
} from "../../shared/more-filters";
import {
  SORT_LABELS,
  emptyFilters,
  type CatalogFilterState,
  type CatalogSort,
} from "./catalog-filters";
import { emptyMoreFilters } from "./more-filter-state";
import { Select } from "./Select";

const SCORE_STEPS = [50, 60, 70, 80, 90] as const;
const ANY = "";

type Props =
  | {
      kind: "anilist";
      type: AniListMediaType;
      value: CatalogFilterState;
      options?: AniListFilterOptions;
      onApply: (next: CatalogFilterState) => void;
      onClose: () => void;
    }
  | {
      kind: "more";
      value: MoreBrowseFilters;
      onApply: (next: MoreBrowseFilters) => void;
      onClose: () => void;
    };

/**
 * Search filters in one panel from the right (search redesign 2026-10-20): choices are chips,
 * nothing opens on top of anything else, and results change only on Apply (batch filtering, as
 * NN/g recommends for people who know what they want). Same AniList / TMDB filters as before.
 */
export function SearchFiltersPanel(props: Props): React.JSX.Element {
  const panel = useRef<HTMLElement>(null);
  const [draftAniList, setDraftAniList] = useState<CatalogFilterState>(() =>
    props.kind === "anilist" ? props.value : emptyFilters(),
  );
  const [draftMore, setDraftMore] = useState<MoreBrowseFilters>(() =>
    props.kind === "more" ? props.value : emptyMoreFilters(),
  );
  const { onClose } = props;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, select")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const years: Array<{ value: string; label: string }> = [];
  const lowest = props.kind === "anilist" ? FILTER_YEAR_MIN : MORE_YEAR_MIN;
  for (let year = filterYearMax(); year >= lowest; year -= 1)
    years.push({ value: String(year), label: String(year) });

  const chips = <T extends string | number>(
    label: string,
    choices: ReadonlyArray<{ value: T; label: string }>,
    selected: T | undefined,
    pick: (value: T | undefined) => void,
    allowNone = true,
  ): React.JSX.Element => (
    <div className="search-filter-group" role="group" aria-label={label}>
      <h3>{label}</h3>
      <div className="search-filter-chips">
        {choices.map((choice) => {
          const on = selected === choice.value;
          return (
            <button
              key={String(choice.value)}
              type="button"
              className={on ? "is-on" : undefined}
              aria-pressed={on}
              onClick={() => pick(on && allowNone ? undefined : choice.value)}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const select = (
    label: string,
    value: string | undefined,
    choices: ReadonlyArray<{ value: string; label: string }>,
    pick: (value: string | undefined) => void,
    disabled = false,
  ): React.JSX.Element => (
    <div className="search-filter-group">
      <h3>{label}</h3>
      <Select
        ariaLabel={label}
        className={`filter-pill search-filter-select${value !== undefined ? " is-set" : ""}`}
        value={value ?? ANY}
        disabled={disabled}
        options={[{ value: ANY, label: `Any ${label.toLocaleLowerCase()}` }, ...choices]}
        onChange={(next) => pick(next || undefined)}
      />
    </div>
  );

  const setAniList = <K extends keyof CatalogFilterState>(key: K, next: CatalogFilterState[K]) =>
    setDraftAniList((current) => {
      const updated = { ...current };
      if (next === undefined) delete updated[key];
      else updated[key] = next;
      if (key === "season" && next !== undefined && updated.year === undefined)
        updated.year = new Date().getFullYear();
      return updated;
    });
  const setMore = <K extends keyof MoreBrowseFilters>(key: K, next: MoreBrowseFilters[K]) =>
    setDraftMore((current) => {
      const updated = { ...current };
      if (next === undefined) delete updated[key];
      else updated[key] = next;
      return updated;
    });

  return (
    <>
      <div className="search-filters-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panel}
        className="search-filters"
        role="dialog"
        aria-modal="true"
        aria-label="Search filters"
      >
        <div className="search-filters-head">
          <h2>Filters</h2>
          <button
            type="button"
            className="search-filters-close"
            aria-label="Close filters"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="search-filters-body">
          {props.kind === "anilist" ? (
            <>
              {chips<CatalogSort>(
                "Sort by",
                (Object.keys(SORT_LABELS) as CatalogSort[]).map((sort) => ({
                  value: sort,
                  label: SORT_LABELS[sort],
                })),
                draftAniList.sort,
                (sort) => sort && setAniList("sort", sort),
                false,
              )}
              {chips(
                "Format",
                formatsFor(props.type).map((format) => ({
                  value: format,
                  label: FORMAT_LABELS[format],
                })),
                draftAniList.format,
                (format) => setAniList("format", format),
              )}
              {chips(
                "Genre",
                (props.options?.genres ?? []).map((genre) => ({ value: genre, label: genre })),
                draftAniList.genre,
                (genre) => setAniList("genre", genre),
              )}
              {chips(
                "Status",
                MEDIA_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
                draftAniList.status,
                (status) => setAniList("status", status),
              )}
              {props.type === "ANIME"
                ? chips(
                    "Season",
                    MEDIA_SEASONS.map((season) => ({
                      value: season,
                      label: SEASON_LABELS[season],
                    })),
                    draftAniList.season,
                    (season) => setAniList("season", season),
                  )
                : null}
              {select("Year", draftAniList.year?.toString(), years, (year) =>
                setAniList("year", year ? Number(year) : undefined),
              )}
              {chips(
                "Country",
                ORIGIN_COUNTRIES.map((country) => ({
                  value: country,
                  label: COUNTRY_LABELS[country],
                })),
                draftAniList.country,
                (country) => setAniList("country", country),
              )}
              {chips(
                "Score",
                SCORE_STEPS.map((score) => ({ value: score, label: `${score / 10}+` })),
                draftAniList.minScore,
                (score) => setAniList("minScore", score),
              )}
              {select(
                "Tag",
                draftAniList.tag,
                (props.options?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name })),
                (tag) => setAniList("tag", tag),
                !props.options?.tags.length,
              )}
            </>
          ) : (
            <>
              {chips<MoreSort>(
                "Sort by",
                (Object.keys(MORE_SORT_LABELS) as MoreSort[]).map((sort) => ({
                  value: sort,
                  label: MORE_SORT_LABELS[sort],
                })),
                draftMore.sort,
                (sort) => sort && setMore("sort", sort),
                false,
              )}
              {chips<MoreMediaType>(
                "Show",
                [
                  { value: "MOVIE", label: "Movies" },
                  { value: "TV", label: "Shows" },
                ],
                draftMore.type,
                (type) => setMore("type", type),
              )}
              {chips(
                "Genre",
                MORE_GENRES.filter((genre) =>
                  draftMore.type === "MOVIE"
                    ? genre.movie
                    : draftMore.type === "TV"
                      ? genre.tv
                      : true,
                ).map((genre) => ({ value: genre.name, label: genre.name })),
                draftMore.genre,
                (genre) => setMore("genre", genre),
              )}
              {select("Year", draftMore.year?.toString(), years, (year) =>
                setMore("year", year ? Number(year) : undefined),
              )}
              {select(
                "Language",
                draftMore.language,
                MORE_LANGUAGES.map((language) => ({ value: language.code, label: language.label })),
                (language) => setMore("language", language),
              )}
              {chips(
                "Score",
                MORE_SCORE_STEPS.map((score) => ({ value: score, label: `${score}+` })),
                draftMore.minScore,
                (score) => setMore("minScore", score),
              )}
            </>
          )}
        </div>
        <div className="search-filters-foot">
          <button
            type="button"
            className="search-filters-clear"
            onClick={() =>
              props.kind === "anilist"
                ? setDraftAniList(emptyFilters())
                : setDraftMore(emptyMoreFilters())
            }
          >
            Clear
          </button>
          <button
            type="button"
            className="search-filters-apply"
            onClick={() => {
              if (props.kind === "anilist") props.onApply(draftAniList);
              else props.onApply(draftMore);
              onClose();
            }}
          >
            Show results
          </button>
        </div>
      </aside>
    </>
  );
}
