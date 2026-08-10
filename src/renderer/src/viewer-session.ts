import type {
  AniListAuthState,
  AniListDashboard,
  AniListEntry,
  AniListListEntrySummary,
  AniListMedia,
  UpdateAniListEntryInput,
  AniStreamBridge,
} from "../../shared/contracts";
import type { ViewerAccess } from "./viewer-access";

export type ViewerSessionBridge = Pick<
  AniStreamBridge,
  | "getAniListAuthState"
  | "onAniListAuthChanged"
  | "startAniListLogin"
  | "cancelAniListLogin"
  | "logoutAniList"
  | "getCachedAniListDashboard"
  | "getAniListDashboard"
  | "addAniListEntry"
  | "updateAniListEntry"
  | "deleteAniListEntry"
>;

export interface ViewerSessionSnapshot {
  auth: AniListAuthState;
  restoring: boolean;
  syncing: boolean;
  error?: string;
  access: ViewerAccess;
}

export interface ViewerSessionModule {
  getSnapshot(): ViewerSessionSnapshot;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  connect(): Promise<void>;
  cancelConnect(): Promise<void>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
  dispose(): void;
}

export function createViewerSession(bridge: ViewerSessionBridge): ViewerSessionModule {
  const listeners = new Set<() => void>();
  let auth: AniListAuthState = { status: "signed-out" };
  let dashboard: AniListDashboard | undefined;
  let restoring = true;
  let syncing = false;
  let error: string | undefined;
  let generation = 0;
  let disposed = false;
  let restored = false;
  let unsubscribeAuth: (() => void) | undefined;
  let snapshot: ViewerSessionSnapshot;

  const messageFrom = (reason: unknown, fallback: string): string =>
    reason instanceof Error ? reason.message : fallback;

  const emptyDashboard = (
    state: Extract<AniListAuthState, { status: "signed-in" }>,
  ): AniListDashboard => ({
    profile: state.profile,
    animeLists: [],
    mangaLists: [],
    fetchedAt: new Date().toISOString(),
  });

  const buildLibraryEntries = (): ReadonlyMap<number, AniListEntry> => {
    const entries = new Map<number, AniListEntry>();
    for (const list of [...(dashboard?.animeLists ?? []), ...(dashboard?.mangaLists ?? [])]) {
      for (const entry of list.entries) entries.set(entry.media.id, entry);
    }
    return entries;
  };

  const refreshLibrary = async (): Promise<void> => {
    await refresh();
  };

  const addToLibrary = async (media: AniListMedia): Promise<AniListListEntrySummary> => {
    if (auth.status !== "signed-in") throw new Error("Connect AniList to manage your library.");
    const result = await bridge.addAniListEntry(media.id);
    await refreshLibrary();
    return result;
  };

  const updateEntry = async (input: UpdateAniListEntryInput): Promise<AniListListEntrySummary> => {
    if (auth.status !== "signed-in") throw new Error("Connect AniList to manage your library.");
    const result = await bridge.updateAniListEntry(input);
    await refreshLibrary();
    return result;
  };

  const removeFromLibrary = async (entry: AniListEntry): Promise<void> => {
    if (auth.status !== "signed-in") throw new Error("Connect AniList to manage your library.");
    await bridge.deleteAniListEntry(entry.id);
    await refreshLibrary();
  };

  const buildAccess = (): ViewerAccess => {
    if (auth.status !== "signed-in" || !dashboard || dashboard.profile.id !== auth.profile.id) {
      return { kind: "guest" };
    }
    return {
      kind: "member",
      dashboard,
      libraryEntries: buildLibraryEntries(),
      addToLibrary,
      updateEntry,
      removeFromLibrary,
      refreshLibrary,
    };
  };

  const notify = (): void => {
    snapshot = { auth, restoring, syncing, error, access: buildAccess() };
    for (const listener of listeners) listener();
  };

  const isCurrent = (expectedGeneration: number, profileId?: number): boolean =>
    !disposed &&
    generation === expectedGeneration &&
    auth.status === "signed-in" &&
    (profileId === undefined || auth.profile.id === profileId);

  async function refresh(expectedGeneration = generation): Promise<void> {
    if (auth.status !== "signed-in" || !isCurrent(expectedGeneration, auth.profile.id)) return;
    const profileId = auth.profile.id;
    syncing = true;
    error = undefined;
    notify();
    try {
      const next = await bridge.getAniListDashboard();
      if (isCurrent(expectedGeneration, profileId) && next.profile.id === profileId) {
        dashboard = next;
        error = undefined;
        notify();
      }
    } catch (reason) {
      if (isCurrent(expectedGeneration, profileId)) {
        error = messageFrom(
          reason,
          "Unable to refresh your AniList lists. Your saved login remains active.",
        );
        notify();
      }
    } finally {
      if (isCurrent(expectedGeneration, profileId)) {
        syncing = false;
        notify();
      }
    }
  }

  async function applyAuthState(nextAuth: AniListAuthState): Promise<void> {
    if (disposed) return;
    generation += 1;
    const currentGeneration = generation;
    auth = nextAuth;
    restoring = false;
    error = nextAuth.status === "error" ? nextAuth.message : undefined;

    if (nextAuth.status !== "signed-in") {
      dashboard = undefined;
      syncing = false;
      notify();
      return;
    }

    if (!dashboard || dashboard.profile.id !== nextAuth.profile.id) {
      dashboard = emptyDashboard(nextAuth);
    }
    notify();

    try {
      const cached = await bridge.getCachedAniListDashboard();
      if (
        isCurrent(currentGeneration, nextAuth.profile.id) &&
        cached?.profile.id === nextAuth.profile.id
      ) {
        dashboard = cached;
        notify();
      }
    } catch {
      // The live refresh remains authoritative when cached restoration is unavailable.
    }

    await refresh(currentGeneration);
  }

  snapshot = { auth, restoring, syncing, error, access: { kind: "guest" } };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async restore() {
      if (disposed) return;
      if (!restored) {
        restored = true;
        unsubscribeAuth = bridge.onAniListAuthChanged((nextAuth) => {
          void applyAuthState(nextAuth);
        });
      }
      try {
        await applyAuthState(await bridge.getAniListAuthState());
      } catch (reason) {
        if (disposed) return;
        restoring = false;
        error = messageFrom(reason, "Unable to read the saved AniList session.");
        notify();
      }
    },

    async connect() {
      error = undefined;
      notify();
      try {
        await bridge.startAniListLogin();
      } catch (reason) {
        error = messageFrom(reason, "Unable to start AniList sign-in.");
        notify();
      }
    },

    async cancelConnect() {
      error = undefined;
      notify();
      try {
        await bridge.cancelAniListLogin();
      } catch (reason) {
        error = messageFrom(reason, "Unable to cancel AniList sign-in.");
        notify();
      }
    },

    async refresh() {
      await refresh(generation);
    },

    async logout() {
      generation += 1;
      auth = { status: "signed-out" };
      dashboard = undefined;
      syncing = false;
      error = undefined;
      notify();
      try {
        await bridge.logoutAniList();
      } catch (reason) {
        error = messageFrom(reason, "Unable to log out of AniList.");
        notify();
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribeAuth?.();
      unsubscribeAuth = undefined;
      listeners.clear();
    },
  };
}
