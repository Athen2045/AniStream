import type {
  AniStreamBridge,
  AniListMediaType,
  MangaDexChapterAvailability,
} from "../../shared/contracts";
import type { LocalActivity } from "../../shared/activity";
import {
  buildPersonalTitles,
  continueTitles,
  personalReleases,
  type ContinueTitle,
  type PersonalAiringUpdate,
  type PersonalRelease,
  type PersonalTitle,
} from "../../shared/personal-library";
import type { ViewerAccess } from "./viewer-access";

const REFRESH_MS = 30 * 60_000;
const MANUAL_REFRESH_MS = 60_000;
/** Progress saved while AniList was unreachable is retried this often (and on reconnect). */
const AUTO_SYNC_MS = 5 * 60_000;
type Bridge = Pick<
  AniStreamBridge,
  | "getLocalActivity"
  | "getPersonalAnimeUpdates"
  | "getMangaDexAvailability"
  | "retryActivitySync"
  | "getPendingAniListChanges"
>;
export interface PersonalLibrarySnapshot {
  continuing: Record<AniListMediaType, ContinueTitle[]>;
  releases: PersonalRelease[];
  /**
   * Every anime behind Continue Watching (including ones caught up and waiting for the next
   * episode, which the rail hides), with progress; the airing schedule follows these.
   */
  continueAnime: { id: number; progress: number }[];
  /** Latest watch/read activity per `TYPE:id` (local plays and AniList progress), epoch ms. */
  activityAt: ReadonlyMap<string, number>;
  pending: number;
  syncing: boolean;
  loading: boolean;
  error?: string;
}
type Check = { key: string; checkedAt: number; flight?: Promise<void>; error?: string };

export function createPersonalLibrarySession(
  initialAccess: ViewerAccess,
  bridge: Bridge,
  runtime: {
    now: () => number;
    visible: () => boolean;
    /** Titles the viewer removed from Continue; they stay out until touched again. */
    hidden?: (title: PersonalTitle) => boolean;
  } = {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
  },
) {
  const shown = (title: PersonalTitle): boolean => !runtime.hidden?.(title);
  let access = initialAccess;
  let active = false;
  let generation = 0;
  let activity: LocalActivity[] = [];
  let pendingEdits = 0;
  let airing: PersonalAiringUpdate[] = [];
  let manga = new Map<number, MangaDexChapterAvailability>();
  let titles: Record<AniListMediaType, PersonalTitle[]> = { ANIME: [], MANGA: [] };
  let checks: Record<AniListMediaType, Check> = freshChecks();
  let localFlight: Promise<void> | undefined;
  let localRevision = 0;
  let localError: string | undefined;
  let syncing = false;
  let lastAutoSync = 0;
  let autoSyncTimer: ReturnType<typeof setInterval> | undefined;
  let mangaRevision = 0;
  const listeners = new Set<() => void>();
  let snapshot: PersonalLibrarySnapshot = {
    continuing: { ANIME: [], MANGA: [] },
    releases: [],
    continueAnime: [],
    activityAt: new Map(),
    pending: 0,
    syncing: false,
    loading: false,
  };

  function rebuild(): void {
    const dashboard = access.kind === "member" ? access.dashboard : undefined;
    const fetchedAt = dashboard ? Date.parse(dashboard.fetchedAt) || undefined : undefined;
    titles = {
      ANIME: buildPersonalTitles(
        "ANIME",
        dashboard?.animeLists.flatMap((group) => group.entries) ?? [],
        activity,
        fetchedAt,
      ),
      MANGA: buildPersonalTitles(
        "MANGA",
        dashboard?.mangaLists.flatMap((group) => group.entries) ?? [],
        activity,
        fetchedAt,
      ),
    };
    snapshot = {
      continuing: {
        ANIME: continueTitles(titles.ANIME.filter(shown), manga, runtime.now()),
        MANGA: continueTitles(titles.MANGA.filter(shown), manga, runtime.now()),
      },
      releases: personalReleases([...titles.ANIME, ...titles.MANGA], airing, manga, runtime.now()),
      continueAnime: titles.ANIME.filter(shown).map(({ media, progress }) => ({
        id: media.id,
        progress,
      })),
      activityAt: activityTimes(
        [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])].flatMap(
          (group) => group.entries,
        ),
        activity,
      ),
      pending: activity.filter((item) => item.syncStatus === "pending").length + pendingEdits,
      syncing,
      loading: Boolean(localFlight || checks.ANIME.flight || checks.MANGA.flight),
      error:
        [localError, checks.ANIME.error, checks.MANGA.error].filter(Boolean).join(" ") || undefined,
    };
    if (active) for (const listener of listeners) listener();
  }

  async function loadLocal(): Promise<void> {
    if (localFlight) return localFlight;
    const expected = generation;
    const request = (async () => {
      let revision: number;
      do {
        revision = localRevision;
        try {
          const [local, edits] = await Promise.all([
            bridge.getLocalActivity(),
            access.kind === "member"
              ? bridge.getPendingAniListChanges().catch(() => 0)
              : Promise.resolve(0),
          ]);
          if (!active || generation !== expected) return;
          activity = local;
          pendingEdits = edits;
          localError = undefined;
        } catch {
          if (active && generation === expected)
            localError = "Local progress could not be loaded. Try refreshing.";
        }
      } while (active && generation === expected && revision !== localRevision);
    })();
    localFlight = request;
    rebuild();
    try {
      await request;
    } finally {
      if (localFlight === request) {
        localFlight = undefined;
        rebuild();
        autoSync(false);
      }
    }
  }

  /** Sends progress queued while offline once AniList may be reachable again. */
  function autoSync(force: boolean): void {
    if (!active || syncing || access.kind !== "member") return;
    if (!pendingEdits && !activity.some((item) => item.syncStatus === "pending")) return;
    if (!force && runtime.now() - lastAutoSync < AUTO_SYNC_MS) return;
    lastAutoSync = runtime.now();
    void session.retrySync();
  }
  const syncOnReconnect = (): void => autoSync(true);

  function candidateKey(type: AniListMediaType): string {
    return `${type === "MANGA" ? mangaRevision : 0}:${JSON.stringify(titles[type].map(({ media }) => ({ aniListId: media.id, title: media.title })).sort((a, b) => a.aniListId - b.aniListId))}`;
  }

  async function check(type: AniListMediaType, force: boolean): Promise<void> {
    if (!active || !runtime.visible()) return;
    const state = checks[type];
    if (state.flight) return state.flight;
    const key = candidateKey(type);
    if (
      state.key === key &&
      runtime.now() - state.checkedAt < (force ? MANUAL_REFRESH_MS : REFRESH_MS)
    )
      return;
    state.key = key;
    state.checkedAt = runtime.now();
    state.error = undefined;
    if (!titles[type].length) {
      if (type === "ANIME") airing = [];
      else manga = new Map();
      rebuild();
      return;
    }
    const expected = generation;
    const candidates = titles[type].map(({ media }) => ({
      aniListId: media.id,
      title: media.title,
    }));
    const request = (async () => {
      try {
        if (type === "ANIME") {
          const result = await bridge.getPersonalAnimeUpdates(
            candidates.map((item) => item.aniListId),
          );
          if (active && generation === expected && key === candidateKey(type)) airing = result;
        } else {
          const result = await bridge.getMangaDexAvailability(candidates);
          if (active && generation === expected && key === candidateKey(type)) {
            manga = new Map(result.map((item) => [item.aniListId, item]));
            if (result.some((item) => item.status === "unavailable"))
              state.error = "Some manga updates could not be checked.";
          }
        }
      } catch {
        if (active && generation === expected && key === candidateKey(type))
          state.error = `${type === "ANIME" ? "Anime" : "Manga"} update check failed. Previous updates may be out of date.`;
      }
    })();
    state.flight = request;
    rebuild();
    try {
      await request;
    } finally {
      if (state.flight === request) state.flight = undefined;
      if (active && generation === expected) {
        rebuild();
        if (key !== candidateKey(type)) void check(type, false);
      }
    }
  }

  async function refresh(force = false): Promise<void> {
    if (!active) return;
    await loadLocal();
    await Promise.all([check("ANIME", force), check("MANGA", force)]);
  }

  rebuild();
  const session = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
      if (typeof window !== "undefined") {
        window.addEventListener("online", syncOnReconnect);
        autoSyncTimer = setInterval(() => autoSync(false), AUTO_SYNC_MS);
      }
      void refresh();
    },
    setAccess(next: ViewerAccess) {
      if (access === next) return;
      if (accessKey(access) !== accessKey(next)) {
        generation += 1;
        checks = freshChecks();
        localFlight = undefined;
        airing = [];
        manga = new Map();
      }
      access = next;
      rebuild();
      if (active) void refresh();
    },
    refresh,
    /** Re-applies Continue removals without reloading anything. */
    invalidateHidden() {
      rebuild();
    },
    invalidateLocal() {
      localRevision += 1;
      void refresh();
    },
    invalidateManga() {
      mangaRevision += 1;
      void check("MANGA", false);
    },
    async retrySync(): Promise<void> {
      if (syncing) return;
      syncing = true;
      rebuild();
      try {
        activity = await bridge.retryActivitySync();
        // The library refresh also sends edits queued while AniList was unreachable.
        if (access.kind === "member") await access.refreshLibrary();
        pendingEdits =
          access.kind === "member" ? await bridge.getPendingAniListChanges().catch(() => 0) : 0;
        localError = undefined;
      } catch {
        localError = "Progress is saved locally, but AniList sync could not finish.";
      } finally {
        syncing = false;
        rebuild();
      }
    },
    dispose() {
      active = false;
      if (typeof window !== "undefined") window.removeEventListener("online", syncOnReconnect);
      if (autoSyncTimer !== undefined) clearInterval(autoSyncTimer);
      autoSyncTimer = undefined;
      generation += 1;
      checks = freshChecks();
      localFlight = undefined;
      listeners.clear();
    },
  };
  return session;
}

function activityTimes(
  entries: { media: { id: number; type: AniListMediaType }; progress: number; updatedAt: number }[],
  activity: LocalActivity[],
): Map<string, number> {
  const times = new Map<string, number>();
  const note = (key: string, at: number): void => {
    if (at > (times.get(key) ?? 0)) times.set(key, at);
  };
  for (const entry of entries)
    if (entry.progress > 0) note(`${entry.media.type}:${entry.media.id}`, entry.updatedAt * 1000);
  for (const local of activity)
    note(`${local.media.type}:${local.media.id}`, Date.parse(local.updatedAt) || 0);
  return times;
}

function freshChecks(): Record<AniListMediaType, Check> {
  return { ANIME: { key: "", checkedAt: 0 }, MANGA: { key: "", checkedAt: 0 } };
}
function accessKey(access: ViewerAccess): string {
  return access.kind === "member" ? String(access.dashboard.profile.id) : "guest";
}
