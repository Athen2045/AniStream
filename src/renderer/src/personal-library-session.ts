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
  type ReleaseAcknowledgement,
} from "../../shared/personal-library";
import type { ViewerAccess } from "./viewer-access";

const REFRESH_MS = 30 * 60_000;
const MANUAL_REFRESH_MS = 60_000;
type Bridge = Pick<
  AniStreamBridge,
  | "getLocalActivity"
  | "getReleaseAcknowledgements"
  | "getPersonalAnimeUpdates"
  | "getMangaDexAvailability"
  | "acknowledgeRelease"
  | "retryActivitySync"
>;
export interface PersonalLibrarySnapshot {
  continuing: Record<AniListMediaType, ContinueTitle[]>;
  releases: PersonalRelease[];
  pending: number;
  syncing: boolean;
  loading: boolean;
  error?: string;
  acknowledging: string[];
}
type Check = { key: string; checkedAt: number; flight?: Promise<void>; error?: string };

export function createPersonalLibrarySession(
  initialAccess: ViewerAccess,
  bridge: Bridge,
  runtime = {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
  },
) {
  let access = initialAccess;
  let active = false;
  let generation = 0;
  let activity: LocalActivity[] = [];
  let acknowledgements: ReleaseAcknowledgement[] = [];
  let airing: PersonalAiringUpdate[] = [];
  let manga = new Map<number, MangaDexChapterAvailability>();
  let titles: Record<AniListMediaType, PersonalTitle[]> = { ANIME: [], MANGA: [] };
  let checks: Record<AniListMediaType, Check> = freshChecks();
  let localFlight: Promise<void> | undefined;
  let localRevision = 0;
  let localError: string | undefined;
  let syncing = false;
  let mangaRevision = 0;
  const acknowledging = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: PersonalLibrarySnapshot = {
    continuing: { ANIME: [], MANGA: [] },
    releases: [],
    pending: 0,
    syncing: false,
    loading: false,
    acknowledging: [],
  };

  function rebuild(): void {
    const dashboard = access.kind === "member" ? access.dashboard : undefined;
    titles = {
      ANIME: buildPersonalTitles(
        "ANIME",
        dashboard?.animeLists.flatMap((group) => group.entries) ?? [],
        activity,
      ),
      MANGA: buildPersonalTitles(
        "MANGA",
        dashboard?.mangaLists.flatMap((group) => group.entries) ?? [],
        activity,
      ),
    };
    snapshot = {
      continuing: {
        ANIME: continueTitles(titles.ANIME, manga, runtime.now()),
        MANGA: continueTitles(titles.MANGA, manga, runtime.now()),
      },
      releases: personalReleases(
        [...titles.ANIME, ...titles.MANGA],
        airing,
        manga,
        acknowledgements,
        runtime.now(),
      ),
      pending: activity.filter((item) => item.syncStatus === "pending").length,
      syncing,
      loading: Boolean(localFlight || checks.ANIME.flight || checks.MANGA.flight),
      error:
        [localError, checks.ANIME.error, checks.MANGA.error].filter(Boolean).join(" ") || undefined,
      acknowledging: [...acknowledging],
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
          const [local, seen] = await Promise.all([
            bridge.getLocalActivity(),
            bridge.getReleaseAcknowledgements(),
          ]);
          if (!active || generation !== expected) return;
          activity = local;
          // A concurrent mark-seen must not be undone by an older local read.
          const merged = new Map(acknowledgements.map((item) => [item.key, item]));
          for (const item of seen)
            if ((merged.get(item.key)?.unit ?? -1) < item.unit) merged.set(item.key, item);
          acknowledgements = [...merged.values()];
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
      }
    }
  }

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
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
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
    invalidateLocal() {
      localRevision += 1;
      void refresh();
    },
    invalidateManga() {
      mangaRevision += 1;
      void check("MANGA", false);
    },
    async acknowledge(item: ReleaseAcknowledgement): Promise<boolean> {
      if (!active || acknowledging.has(item.key)) return false;
      acknowledging.add(item.key);
      rebuild();
      try {
        await bridge.acknowledgeRelease({ key: item.key, unit: item.unit });
        acknowledgements = [
          ...acknowledgements.filter((row) => row.key !== item.key),
          {
            key: item.key,
            unit: Math.max(
              item.unit,
              acknowledgements.find((row) => row.key === item.key)?.unit ?? 0,
            ),
          },
        ];
        localError = undefined;
        return true;
      } catch {
        localError = "Could not mark this update as seen. Please try again.";
        return false;
      } finally {
        acknowledging.delete(item.key);
        rebuild();
      }
    },
    async retrySync(): Promise<void> {
      if (syncing) return;
      syncing = true;
      rebuild();
      try {
        activity = await bridge.retryActivitySync();
        if (access.kind === "member") await access.refreshLibrary();
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
      generation += 1;
      checks = freshChecks();
      localFlight = undefined;
      listeners.clear();
    },
  };
}

function freshChecks(): Record<AniListMediaType, Check> {
  return { ANIME: { key: "", checkedAt: 0 }, MANGA: { key: "", checkedAt: 0 } };
}
function accessKey(access: ViewerAccess): string {
  return access.kind === "member" ? String(access.dashboard.profile.id) : "guest";
}
