import { useMemo, useState } from "react";
import type { AniListDashboard, AniListMediaType } from "../../shared/contracts";
import {
  buildLibraryShelves,
  defaultShelfKey,
  filterLibrary,
  type LibrarySort,
} from "./profile-library";

/**
 * The Profile page's library browsing: Anime or Manga, the shelf, its search, format filter and
 * sort. Kept above the Profile route so the choices survive leaving Profile and coming back.
 */
export function useProfileLibrary(dashboard: AniListDashboard | undefined) {
  const [mediaType, setMediaType] = useState<AniListMediaType>("ANIME");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("UPDATED_DESC");
  const [formatFilter, setFormatFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const groups = mediaType === "ANIME" ? dashboard?.animeLists : dashboard?.mangaLists;
  // Profile shelves: one per status (AniList's per-format lists merged) plus custom lists.
  const shelves = useMemo(
    () => buildLibraryShelves(groups ?? [], mediaType === "ANIME"),
    [groups, mediaType],
  );
  const activeShelf =
    shelves.find((shelf) => shelf.key === selectedGroup) ??
    shelves.find((shelf) => shelf.key === defaultShelfKey(shelves));
  const visibleEntries = useMemo(
    () =>
      filterLibrary(activeShelf?.entries ?? [], {
        query: listQuery,
        format: formatFilter,
        sort: librarySort,
      }),
    [activeShelf, formatFilter, librarySort, listQuery],
  );

  return {
    mediaType,
    shelves,
    activeShelfKey: activeShelf?.key ?? "",
    visibleEntries,
    listQuery,
    setListQuery,
    librarySort,
    setLibrarySort,
    formatFilter,
    setFormatFilter,
    adding,
    toggleAdding: (): void => setAdding((value) => !value),
    switchMediaType: (type: AniListMediaType): void => {
      setMediaType(type);
      setListQuery("");
      setSelectedGroup("");
      setFormatFilter("");
    },
    selectShelf: (key: string): void => {
      setSelectedGroup(key);
      setFormatFilter("");
    },
  };
}
