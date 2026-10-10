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
import { friendlyRemoteError } from "./remote-error";

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
  availabilityMedia: MangaDexAvailabilityInput[];
  trackAvailabilityNow?: boolean;
  /** False when the viewer turned Latest Updates off: the grid's pages are not requested. */
  latest?: boolean;
}

export interface CatalogDataSnapshot {
  type: AniListMediaType;
  latestPage: number;
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

/** Trending pages that loaded successfully; shared by every module given the same object. */
export interface CatalogTrendingCache {
  /** An empty list is AniList's own empty answer; the MAL ranking then stands in. */
  trending: Partial<Record<AniListMediaType, AniListCatalogPage["items"]>>;
  fallback: Partial<Record<AniListMediaType, MalRankingItem[]>>;
}

export function createCatalogDataModule(
  api: CatalogDataApi,
  runtime: CatalogDataRuntime = defaultRuntime,
  shared: CatalogTrendingCache = { trending: {}, fallback: {} },
): CatalogDataModule {
  let snapshot: CatalogDataSnapshot = {
    type: "ANIME",
    latestPage: 1,
    trending: [],
    malTrendingFallback: [],
    trendingLoading: true,
    latestAnime: [],
    latestManga: [],
    latestLoading: true,
    mangaAvailability: new Map(),
  };
  let active = false;
  let disposed = false;
  let requestIdentity = 0;
  let latestRequestIdentity: number | undefined;
  let availabilityRequestIdentity: number | undefined;
  const trendingRequestIdentity: Partial<Record<AniListMediaType, number>> = {};
  const fallbackRequestIdentity: Partial<Record<AniListMediaType, number>> = {};
  const trendingByType: Partial<Record<AniListMediaType, AniListCatalogPage["items"]>> = {};
  const trendingFailedByType = new Set<AniListMediaType>();
  const fallbackByType: Partial<Record<AniListMediaType, MalRankingItem[]>> = {};
  const fallbackFor = (type: AniListMediaType) => fallbackByType[type] ?? shared.fallback[type];
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
  let latestEnabled = true;
  let clockTimer: unknown;

  const publish = (next: Partial<CatalogDataSnapshot>): void => {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  const invalidateViewRequests = (): void => {
    latestRequestIdentity = undefined;
    const type = snapshot.type;
    trendingRequestIdentity[type] = undefined;
    fallbackRequestIdentity[type] = undefined;
  };

  const isCurrentView = (type: AniListMediaType): boolean => !disposed && snapshot.type === type;

  const loadFallback = (type: AniListMediaType): void => {
    if (fallbackFor(type) !== undefined || fallbackRequestIdentity[type] !== undefined) return;
    const identity = ++requestIdentity;
    fallbackRequestIdentity[type] = identity;
    void api
      .getMalTrendingFallback(type)
      .then((ranking) => {
        if (fallbackRequestIdentity[type] !== identity || !isCurrentView(type)) {
          return;
        }
        fallbackByType[type] = ranking;
        shared.fallback[type] = ranking;
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

  const trendingFor = (type: AniListMediaType) => trendingByType[type] ?? shared.trending[type];

  const loadTrending = (type: AniListMediaType): void => {
    const cached = trendingFor(type);
    if (cached !== undefined) {
      if (trendingFailedByType.has(type) || !cached.length) loadFallback(type);
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
        const trending = result.items.slice(0, TRENDING_LIMIT);
        // Kept even if the viewer already switched sections, so returning shows it at once.
        // AniList's empty answer is kept too (with the MAL stand-in), so it is not re-asked.
        shared.trending[type] = trending;
        if (trendingRequestIdentity[type] !== identity || !isCurrentView(type)) return;
        if (!trending.length) {
          // AniList can answer an empty trending page while degraded; show MAL instead of a blank.
          trendingFailedByType.add(type);
          trendingByType[type] = [];
          publish({ trending: [] });
          loadFallback(type);
          return;
        }
        trendingFailedByType.delete(type);
        trendingByType[type] = trending;
        publish({ trending });
      })
      .catch((reason: unknown) => {
        if (trendingRequestIdentity[type] !== identity || !isCurrentView(type)) return;
        trendingFailedByType.add(type);
        trendingByType[type] = [];
        publish({
          trending: [],
          error: friendlyRemoteError(reason, {
            provider: "AniList",
            operation: "trending titles",
            fallback: "Trending titles are unavailable right now. Try again shortly.",
          }),
        });
        loadFallback(type);
      })
      .finally(() => {
        if (trendingRequestIdentity[type] !== identity) return;
        trendingRequestIdentity[type] = undefined;
        if (isCurrentView(type)) publish({ trendingLoading: false });
      });
  };

  const loadLatest = (): void => {
    const { type, latestPage } = snapshot;
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
          !isCurrentView(type) ||
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
          isCurrentView(type) &&
          snapshot.latestPage === latestPage
        ) {
          publish({
            latestError: friendlyRemoteError(reason, {
              provider: type === "ANIME" ? "AniList" : "MangaDex",
              operation: `latest ${type.toLowerCase()} updates`,
              retained: Boolean(
                type === "ANIME"
                  ? latestByType.ANIME.anime.length
                  : latestByType.MANGA.manga.length,
              ),
              fallback: `Latest ${type.toLowerCase()} updates are unavailable right now. Try again shortly.`,
            }),
          });
        }
      })
      .finally(() => {
        if (
          latestRequestIdentity === identity &&
          isCurrentView(type) &&
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
      const viewChanged = !active || snapshot.type !== context.type;
      active = true;
      const wantLatest = context.latest !== false;
      const latestTurnedOn = wantLatest && !latestEnabled;
      latestEnabled = wantLatest;

      if (viewChanged) {
        invalidateViewRequests();
        snapshot = {
          ...snapshot,
          type: context.type,
          latestPage: 1,
          trending: trendingFor(context.type) ?? [],
          malTrendingFallback: fallbackFor(context.type) ?? [],
          trendingLoading: trendingFor(context.type) === undefined,
          latestAnime: latestByType[context.type].anime,
          latestManga: latestByType[context.type].manga,
          latestPageInfo: undefined,
          latestLoading: true,
          latestError: undefined,
          error: undefined,
        };
        listeners.forEach((listener) => listener());
      }

      configureClock(Boolean(context.trackAvailabilityNow));
      configureAvailability(context);

      if (viewChanged) {
        loadTrending(context.type);
        if (latestEnabled) loadLatest();
      } else if (latestTurnedOn) {
        latestRequestIdentity = undefined;
        publish({ latestLoading: true, latestError: undefined });
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
    setLatestPage(page) {
      if (disposed || page === snapshot.latestPage) return;
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
