import type { AniListFilterOptions } from "../../shared/anilist-filters";
import type { FilterOptionsResponse } from "./queries";

/** AniList's one adult genre; the catalog drawer never offers it. */
const ADULT_GENRES = new Set(["Hentai"]);
const MAX_GENRES = 60;
const MAX_TAGS = 800;

function isSafeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !/[\p{Cc}]/u.test(value)
  );
}

/** Keeps well-formed, non-adult genre and tag names; anything else in the payload is dropped. */
export function normalizeFilterOptions(response: FilterOptionsResponse): AniListFilterOptions {
  const genres = Array.isArray(response.GenreCollection)
    ? [
        ...new Set(
          response.GenreCollection.filter(isSafeName).filter((genre) => !ADULT_GENRES.has(genre)),
        ),
      ].slice(0, MAX_GENRES)
    : [];
  const seen = new Set<string>();
  const tags: AniListFilterOptions["tags"] = [];
  if (Array.isArray(response.MediaTagCollection)) {
    for (const row of response.MediaTagCollection.slice(0, MAX_TAGS * 2)) {
      if (!row || typeof row !== "object") continue;
      const { name, category, isAdult } = row as Record<string, unknown>;
      if (isAdult !== false || !isSafeName(name) || seen.has(name)) continue;
      seen.add(name);
      tags.push(isSafeName(category) ? { name, category } : { name });
      if (tags.length >= MAX_TAGS) break;
    }
  }
  tags.sort((a, b) => a.name.localeCompare(b.name));
  return { genres, tags };
}
