import type {
  AniListCatalogPage,
  AniListMediaType,
  AniListPageInfo,
  AniStreamBridge,
  LatestAnimeUpdate,
  LatestMangaUpdate,
  MalRankingItem,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
} from "../../shared/contracts";

const TRENDING_LIMIT = 20;
const AVAILABILITY_CLOCK_INTERVAL_MS = 5 * 60_000;
const AVAILABILITY_REFRESH_INTERVAL_MS = 30 * 60_000;

export type CatalogDataApi = Pick<
  AniStreamBridge,
  | "browseAniList"
  | "getLatestAnimeUpdates"
  | "getLatestMangaUpdates"
  | "getMalTrendingFallback"
  | "getMangaDexAvailability"
>;

export interface CatalogDataContext {
  type: AniListMediaType;
  searchQuery: string;
  availabilityMedia: MangaDexAvailabilityInput[];
  trackAvailabilityNow?: boolean;
}

export interface CatalogDataSnapshot {
  type: AniListMediaType;
  searchQuery: string;
  page: number;
  latestPage: number;
  searchResults?: AniListCatalogPage;
  trending: AniListCatalogPage["items"];
  malTrendingFallback: MalRankingItem[];
  trendingLoading: boolean;
  latestAnime: LatestAnimeUpdate[];
  latestManga: LatestMangaUpdate[];
  latestPageInfo?: AniListPageInfo;
  latestLoading: boolean;
  latestError?: string;
  mangaAvailability: Map<number, MangaDexChapterAvailability>;
  availabilityNow?: number;
  loading: boolean;
  error?: string;
}

export interface CatalogDataRuntime {
  now(): number;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  isVisible(): boolean;
  onVisibilityChange(callback: () => void): () => void;
}

export interface CatalogDataModule {
  activate(context: CatalogDataContext): void;
  deactivate(): void;
  getSnapshot(): CatalogDataSnapshot;
  subscribe(listener: () => void): () => void;
  setSearchPage(page: number): void;
  setLatestPage(page: number): void;
  refreshAvailability(): void;
  dispose(): void;
}

interface LatestCache {
  anime: LatestAnimeUpdate[];
  manga: LatestMangaUpdate[];
}

const defaultRuntime: CatalogDataRuntime = {
  now: () => Date.now(),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
  onVisibilityChange: (callback) => {
    if (typeof document === "undefined") return () => undefined;
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
};

export function createCatalogDataModule(
  api: CatalogDataApi,
  runtime: CatalogDataRuntime = defaultRuntime,
): CatalogDataModule {
  let snapshot: CatalogDataSnapshot = {
    type: "ANIME",
    searchQuery: "",
    page: 1,
    latestPage: 1,
    trending: [],
    malTrendingFallback: [],
    trendingLoading: true,
    latestAnime: [],
    latestManga: [],
    latestLoading: true,
    mangaAvailability: new Map(),
    loading: true,
  };
  let active = false;
  let disposed = false;
  let requestIdentity = 0;
  let searchRequestIdentity: number | undefined;
  let latestRequestIdentity: number | undefined;
  let availabilityRequestIdentity: number | undefined;
  const trendingRequestIdentity: Partial<Record<AniListMediaType, number>> = {};
  const fallbackRequestIdentity: Partial<Record<AniListMediaType, number>> = {};
  const trendingByType: Partial<Record<AniListMediaType, AniListCatalogPage["items"]>> = {};
  const trendingFailedByType = new Set<AniListMediaType>();
  const fallbackByType: Partial<Record<AniListMediaType, MalRankingItem[]>> = {};
  const latestByType: Record<AniListMediaType, LatestCache> = {
    ANIME: { anime: [], manga: [] },
    MANGA: { anime: [], manga: [] },
  };
  const listeners = new Set<() => void>();
  let availabilityKey = "";
  let availabilityMedia: MangaDexAvailabilityInput[] = [];
  let availabilityTimer: unknown;
  let removeVisibilityListener: (() => void) | undefined;
  let clockEnabled = false;
  let clockTimer: unknown;

  const publish = (next: Partial<CatalogDataSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  const invalidateViewRequests = (): void => {
    searchRequestIdentity = undefined;
    latestRequestIdentity = undefined;
    const type = snapshot.type;
    trendingRequestIdentity[type] = undefined;
    fallbackRequestIdentity[type] = undefined;
  };

  const isCurrentView = (type: AniListMediaType, searchQuery: string): boolean =>
    !disposed && snapshot.type === type && snapshot.searchQuery === searchQuery;

  const loadFallback = (type: AniListMediaType): void => {
    if (fallbackByType[type] !== undefined || fallbackRequestIdentity[type] !== undefined) return;
    const identity = ++requestIdentity;
    fallbackRequestIdentity[type] = identity;
    void api
      .getMalTrendingFallback(type)
      .then((ranking) => {
        if (fallbackRequestIdentity[type] !== identity || !isCurrentView(type, "")) {
          return;
        }
        fallbackByType[type] = ranking;
        publish({ malTrendingFallback: ranking });
      })
      .catch(() => {
        // The AniList error remains the primary degraded-mode message.
      })
      .finally(() => {
        if (fallbackRequestIdentity[type] === identity) {
          fallbackRequestIdentity[type] = undefined;
        }
      });
  };

  const loadTrending = (type: AniListMediaType): void => {
    const cached = trendingByType[type];
    if (cached !== undefined) {
      if (trendingFailedByType.has(type)) loadFallback(type);
      return;
    }
    if (trendingRequestIdentity[type] !== undefined) return;

    const identity = ++requestIdentity;
    trendingRequestIdentity[type] = identity;
    publish({ trendingLoading: true });
    void api
      .browseAniList({
        type,
        page: 1,
        perPage: TRENDING_LIMIT,
        sort: "TRENDING_DESC",
      })
      .then((result) => {
        if (trendingRequestIdentity[type] !== identity || !isCurrentView(type, "")) return;
        const trending = result.items.slice(0, TRENDING_LIMIT);
        trendingFailedByType.delete(type);
        trendingByType[type] = trending;
        publish({ trending });
      })
      .catch((reason: unknown) => {
        if (trendingRequestIdentity[type] !== identity || !isCurrentView(type, "")) return;
        trendingFailedByType.add(type);
        trendingByType[type] = [];
        publish({
          trending: [],
          error: errorMessage(reason, "AniList browse failed."),
        });
        loadFallback(type);
      })
      .finally(() => {
        if (trendingRequestIdentity[type] !== identity) return;
        trendingRequestIdentity[type] = undefined;
        if (isCurrentView(type, "")) publish({ trendingLoading: false });
      });
  };

  const loadSearch = (): void => {
    const { type, searchQuery, page } = snapshot;
    if (!searchQuery) return;
    const identity = ++requestIdentity;
    searchRequestIdentity = identity;
    void api
      .browseAniList({ type, page, perPage: 24, query: searchQuery, sort: "POPULARITY_DESC" })
      .then((result) => {
        if (
          searchRequestIdentity === identity &&
          isCurrentView(type, searchQuery) &&
          snapshot.page === page
        ) {
          publish({ searchResults: result });
        }
      })
      .catch((reason: unknown) => {
        if (
          searchRequestIdentity === identity &&
          isCurrentView(type, searchQuery) &&
          snapshot.page === page
        ) {
          publish({ error: errorMessage(reason, "AniList search failed.") });
        }
      })
      .finally(() => {
        if (
          searchRequestIdentity === identity &&
          isCurrentView(type, searchQuery) &&
          snapshot.page === page
        ) {
          searchRequestIdentity = undefined;
          publish({ loading: false });
        }
      });
  };

  const loadLatest = (): void => {
    const { type, searchQuery, latestPage } = snapshot;
    if (searchQuery) return;
    const identity = ++requestIdentity;
    latestRequestIdentity = identity;
    const request =
      type === "ANIME"
        ? api.getLatestAnimeUpdates(latestPage)
        : api.getLatestMangaUpdates(latestPage);
    void request
      .then((result) => {
        if (
          latestRequestIdentity !== identity ||
          !isCurrentView(type, "") ||
          snapshot.latestPage !== latestPage
        ) {
          return;
        }
        if (type === "ANIME") {
          latestByType.ANIME.anime = result.items as LatestAnimeUpdate[];
        } else {
          latestByType.MANGA.manga = result.items as LatestMangaUpdate[];
        }
        publish({
          latestAnime: latestByType[type].anime,
          latestManga: latestByType[type].manga,
          latestPageInfo: result.pageInfo,
        });
      })
      .catch((reason: unknown) => {
        if (
          latestRequestIdentity === identity &&
          isCurrentView(type, "") &&
          snapshot.latestPage === latestPage
        ) {
          publish({
            latestError: errorMessage(reason, `Latest ${type.toLowerCase()} failed.`),
          });
        }
      })
      .finally(() => {
        if (
          latestRequestIdentity === identity &&
          isCurrentView(type, "") &&
          snapshot.latestPage === latestPage
        ) {
          latestRequestIdentity = undefined;
          publish({ latestLoading: false });
        }
      });
  };

  const clearAvailabilityRefresh = (): void => {
    availabilityRequestIdentity = undefined;
    if (availabilityTimer !== undefined) runtime.clearInterval(availabilityTimer);
    availabilityTimer = undefined;
    removeVisibilityListener?.();
    removeVisibilityListener = undefined;
  };

  const refreshAvailability = (): void => {
    if (snapshot.type !== "MANGA" || availabilityMedia.length === 0) return;
    const requestedKey = availabilityKey;
    const identity = ++requestIdentity;
    availabilityRequestIdentity = identity;
    void api
      .getMangaDexAvailability(availabilityMedia)
      .then((availability) => {
        if (
          availabilityRequestIdentity === identity &&
          availabilityKey === requestedKey &&
          snapshot.type === "MANGA"
        ) {
          publish({
            mangaAvailability: new Map(availability.map((item) => [item.aniListId, item])),
          });
        }
      })
      .catch(() => {
        // Availability is optional; AniList progress remains visible on provider failure.
      })
      .finally(() => {
        if (availabilityRequestIdentity === identity) availabilityRequestIdentity = undefined;
      });
  };

  const configureAvailability = (context: CatalogDataContext): void => {
    const nextKey =
      context.type === "MANGA"
        ? context.availabilityMedia
            .map((item) => `${item.aniListId}:${item.title}`)
            .sort()
            .join("|")
        : "";
    if (nextKey === availabilityKey) return;

    clearAvailabilityRefresh();
    availabilityKey = nextKey;
    availabilityMedia = context.type === "MANGA" ? [...context.availabilityMedia] : [];
    if (!nextKey) return;

    refreshAvailability();
    availabilityTimer = runtime.setInterval(() => {
      if (runtime.isVisible()) refreshAvailability();
    }, AVAILABILITY_REFRESH_INTERVAL_MS);
    removeVisibilityListener = runtime.onVisibilityChange(() => {
      if (runtime.isVisible()) refreshAvailability();
    });
  };

  const configureClock = (enabled: boolean): void => {
    if (clockEnabled === enabled) return;
    clockEnabled = enabled;
    if (clockTimer !== undefined) runtime.clearInterval(clockTimer);
    clockTimer = undefined;
    if (enabled) {
      clockTimer = runtime.setInterval(
        () => publish({ availabilityNow: runtime.now() }),
        AVAILABILITY_CLOCK_INTERVAL_MS,
      );
    }
  };

  return {
    activate(context) {
      if (disposed) return;
      const viewChanged =
        !active || snapshot.type !== context.type || snapshot.searchQuery !== context.searchQuery;
      active = true;

      if (viewChanged) {
        invalidateViewRequests();
        snapshot = {
          ...snapshot,
          type: context.type,
          searchQuery: context.searchQuery,
          page: 1,
          latestPage: 1,
          searchResults: undefined,
          trending: trendingByType[context.type] ?? [],
          malTrendingFallback: fallbackByType[context.type] ?? [],
          trendingLoading: !context.searchQuery && trendingByType[context.type] === undefined,
          latestAnime: latestByType[context.type].anime,
          latestManga: latestByType[context.type].manga,
          latestPageInfo: undefined,
          latestLoading: true,
          latestError: undefined,
          loading: true,
          error: undefined,
        };
        listeners.forEach((listener) => listener());
      }

      configureClock(Boolean(context.trackAvailabilityNow));
      configureAvailability(context);

      if (context.searchQuery) {
        if (viewChanged) loadSearch();
      } else if (viewChanged) {
        loadTrending(context.type);
        loadLatest();
      }
    },
    deactivate() {
      if (disposed) return;
      active = false;
      invalidateViewRequests();
      clearAvailabilityRefresh();
      availabilityKey = "";
      availabilityMedia = [];
      configureClock(false);
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSearchPage(page) {
      if (disposed || !snapshot.searchQuery || page === snapshot.page) return;
      searchRequestIdentity = undefined;
      publish({ page, loading: true, error: undefined });
      loadSearch();
    },
    setLatestPage(page) {
      if (disposed || snapshot.searchQuery || page === snapshot.latestPage) return;
      latestRequestIdentity = undefined;
      publish({ latestPage: page, latestLoading: true, latestError: undefined });
      loadLatest();
    },
    refreshAvailability,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateViewRequests();
      clearAvailabilityRefresh();
      if (clockTimer !== undefined) runtime.clearInterval(clockTimer);
      clockTimer = undefined;
      listeners.clear();
    },
  };
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
