import type { AniListEntry, AniListEntryStatus, AniListGroup } from "../../shared/contracts";

export type LibrarySort = "UPDATED_DESC" | "TITLE_ASC" | "SCORE_DESC" | "PROGRESS_DESC";
export type LibraryView = "grid" | "list";

export interface LibraryShelf {
  /** `status:CURRENT` for a status, `list:<name>` for an AniList custom list. */
  key: string;
  label: string;
  entries: AniListEntry[];
}

const STATUS_ORDER: AniListEntryStatus[] = [
  "CURRENT",
  "REPEATING",
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "PLANNING",
];

export function statusLabel(status: AniListEntryStatus, anime: boolean): string {
  switch (status) {
    case "CURRENT":
      return anime ? "Watching" : "Reading";
    case "REPEATING":
      return anime ? "Rewatching" : "Rereading";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "DROPPED":
      return "Dropped";
    case "PLANNING":
      return "Planning";
  }
}

/**
 * One shelf per status, merging AniList's per-format lists (Completed TV, Completed Movie, ...),
 * followed by the viewer's custom lists. Empty shelves are omitted.
 */
export function buildLibraryShelves(groups: AniListGroup[], anime: boolean): LibraryShelf[] {
  const byStatus = new Map<AniListEntryStatus, Map<number, AniListEntry>>();
  for (const group of groups) {
    if (group.isCustomList) continue;
    for (const entry of group.entries) {
      const shelf = byStatus.get(entry.status) ?? new Map<number, AniListEntry>();
      shelf.set(entry.id, entry);
      byStatus.set(entry.status, shelf);
    }
  }
  return [
    ...STATUS_ORDER.flatMap((status) => {
      const entries = byStatus.get(status);
      return entries?.size
        ? [
            {
              key: `status:${status}`,
              label: statusLabel(status, anime),
              entries: [...entries.values()],
            },
          ]
        : [];
    }),
    ...groups
      .filter((group) => group.isCustomList && group.entries.length)
      .map((group) => ({ key: `list:${group.name}`, label: group.name, entries: group.entries })),
  ];
}

/** Watching/Reading when present, otherwise the first shelf. */
export function defaultShelfKey(shelves: LibraryShelf[]): string {
  return (shelves.find((shelf) => shelf.key === "status:CURRENT") ?? shelves[0])?.key ?? "";
}

export function shelfFormats(shelf: LibraryShelf | undefined): string[] {
  return [
    ...new Set(
      (shelf?.entries ?? []).flatMap((entry) => (entry.media.format ? [entry.media.format] : [])),
    ),
  ].sort();
}

export function filterLibrary(
  entries: AniListEntry[],
  { query, format, sort }: { query: string; format: string; sort: LibrarySort },
): AniListEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (!needle || entry.media.title.toLocaleLowerCase().includes(needle)) &&
        (!format || entry.media.format === format),
    )
    .sort((left, right) => {
      if (sort === "TITLE_ASC") return left.media.title.localeCompare(right.media.title);
      if (sort === "SCORE_DESC") return right.score - left.score;
      if (sort === "PROGRESS_DESC") return right.progress - left.progress;
      return right.updatedAt - left.updatedAt;
    });
}

/** Mean of rated entries across both libraries; undefined when nothing is rated. */
export function meanScore(groups: AniListGroup[]): { mean: number; rated: number } | undefined {
  const seen = new Map<number, number>();
  for (const group of groups)
    for (const entry of group.entries) if (entry.score > 0) seen.set(entry.id, entry.score);
  if (!seen.size) return undefined;
  const total = [...seen.values()].reduce((sum, score) => sum + score, 0);
  return { mean: total / seen.size, rated: seen.size };
}

const VIEW_KEY = "anistream.profile.view.";

/** Grid by default; a viewer's choice of list view is remembered per library type. */
export function readLibraryView(type: string): LibraryView {
  try {
    return localStorage.getItem(VIEW_KEY + type) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function writeLibraryView(type: string, view: LibraryView): void {
  try {
    localStorage.setItem(VIEW_KEY + type, view);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}
