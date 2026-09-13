import type {
  AniListCatalogPage,
  AniListMediaType,
  AniStreamBridge,
  BrowseAniListInput,
} from "../../shared/contracts";
import { friendlyRemoteError } from "./remote-error";

export type SearchType = "ALL" | AniListMediaType;
export type SearchSort = NonNullable<BrowseAniListInput["sort"]>;
export interface SearchFilters {
  query: string;
  type: SearchType;
  genre: string;
  sort: SearchSort;
}
export interface SearchGroup {
  page: number;
  requestedPage?: number;
  result?: AniListCatalogPage;
  loading: boolean;
  error?: string;
}
export interface SearchSnapshot {
  filters: SearchFilters;
  groups: Record<AniListMediaType, SearchGroup>;
}
const emptyGroups = (): SearchSnapshot["groups"] => ({
  ANIME: { page: 1, loading: false },
  MANGA: { page: 1, loading: false },
});

/** Renderer coordination only. Provider validation, caching and throttling stay in main. */
export function createSearchSession(api: Pick<AniStreamBridge, "browseAniList">) {
  let state: SearchSnapshot = {
    filters: { query: "", type: "ALL", genre: "", sort: "POPULARITY_DESC" },
    groups: emptyGroups(),
  };
  let active = true;
  const revisions = { ANIME: 0, MANGA: 0 };
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const update = (type: AniListMediaType, patch: Partial<SearchGroup>) => {
    state = { ...state, groups: { ...state.groups, [type]: { ...state.groups[type], ...patch } } };
    publish();
  };
  const load = async (type: AniListMediaType, page = state.groups[type].page): Promise<void> => {
    if (
      !active ||
      state.filters.query.length < 2 ||
      (state.filters.type !== "ALL" && state.filters.type !== type)
    )
      return;
    const revision = ++revisions[type];
    const { query, genre, sort } = state.filters;
    update(type, { loading: true, requestedPage: page, error: undefined });
    try {
      const result = await api.browseAniList({
        type,
        page,
        perPage: 24,
        query,
        genre: genre || undefined,
        sort,
      });
      if (!active || revision !== revisions[type]) return;
      update(type, { page, result, loading: false });
    } catch (error) {
      if (active && revision === revisions[type])
        update(type, {
          loading: false,
          error: friendlyRemoteError(error, {
            provider: "AniList",
            operation: "search results",
            retained: Boolean(state.groups[type].result?.items.length),
            fallback: "Search is unavailable right now. Try again shortly.",
          }),
        });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      revisions.ANIME++;
      revisions.MANGA++;
    },
    search(filters: SearchFilters) {
      revisions.ANIME++;
      revisions.MANGA++;
      state = {
        filters: { ...filters, query: filters.query.trim(), genre: filters.genre.trim() },
        groups: emptyGroups(),
      };
      publish();
      return Promise.all(
        (filters.type === "ALL" ? (["ANIME", "MANGA"] as const) : [filters.type]).map((type) =>
          load(type, 1),
        ),
      );
    },
    page: load,
    retry: (type: AniListMediaType) => load(type, state.groups[type].requestedPage),
  };
}
