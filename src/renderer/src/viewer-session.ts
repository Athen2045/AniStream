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
import { friendlyRemoteError } from "./remote-error";

export type ViewerSessionBridge = Pick<
  AniStreamBridge,
  | "getAniListAuthState"
  | "onAniListAuthChanged"
  | "onActivityChanged"
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
  hasVerifiedDashboard: boolean;
  error?: string;
  access: ViewerAccess;
}

export interface ViewerSessionModule {
  activate(): void;
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
  let dashboardVerified = false;
  let restoring = true;
  let syncing = false;
  let error: string | undefined;
  let generation = 0;
  let disposed = false;
  let restored = false;
  let unsubscribeAuth: (() => void) | undefined;
  let unsubscribeActivity: (() => void) | undefined;
  let snapshot: ViewerSessionSnapshot;
  const guestAccess: ViewerAccess = { kind: "guest" };
  let dashboardRevision = 0;
  let accessDashboardRevision = -1;
  let memberAccess: Extract<ViewerAccess, { kind: "member" }> | undefined;

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
      accessDashboardRevision = -1;
      memberAccess = undefined;
      return guestAccess;
    }
    if (memberAccess && accessDashboardRevision === dashboardRevision) return memberAccess;
    accessDashboardRevision = dashboardRevision;
    memberAccess = {
      kind: "member",
      dashboard,
      libraryEntries: buildLibraryEntries(),
      addToLibrary,
      updateEntry,
      removeFromLibrary,
      refreshLibrary,
    };
    return memberAccess;
  };

  const notify = (): void => {
    snapshot = {
      auth,
      restoring,
      syncing,
      hasVerifiedDashboard: dashboardVerified,
      error,
      access: buildAccess(),
    };
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
        dashboardRevision += 1;
        dashboardVerified = true;
        error = undefined;
        notify();
      }
    } catch (reason) {
      if (isCurrent(expectedGeneration, profileId)) {
        error = friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "library data",
          retained: dashboardVerified,
          fallback: "Your AniList library could not be refreshed. Try again shortly.",
        });
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
    error =
      nextAuth.status === "error"
        ? friendlyRemoteError(nextAuth.message, {
            provider: "AniList",
            operation: "profile data",
            fallback:
              "AniList sign-in could not finish. Return to Profile and try connecting again.",
          })
        : undefined;

    if (nextAuth.status !== "signed-in") {
      dashboard = undefined;
      dashboardRevision += 1;
      dashboardVerified = false;
      syncing = false;
      notify();
      return;
    }

    if (!dashboard || dashboard.profile.id !== nextAuth.profile.id) {
      dashboard = emptyDashboard(nextAuth);
      dashboardRevision += 1;
      dashboardVerified = false;
    }
    notify();

    try {
      const cached = await bridge.getCachedAniListDashboard();
      if (
        isCurrent(currentGeneration, nextAuth.profile.id) &&
        cached?.profile.id === nextAuth.profile.id
      ) {
        dashboard = cached;
        dashboardRevision += 1;
        dashboardVerified = true;
        notify();
      }
    } catch {
      // The live refresh remains authoritative when cached restoration is unavailable.
    }

    await refresh(currentGeneration);
  }

  snapshot = {
    auth,
    restoring,
    syncing,
    hasVerifiedDashboard: dashboardVerified,
    error,
    access: guestAccess,
  };

  return {
    activate() {
      disposed = false;
    },
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async restore() {
      if (disposed) return;
      const restoreGeneration = generation;
      if (!restored) {
        restored = true;
        unsubscribeAuth = bridge.onAniListAuthChanged((nextAuth) => {
          void applyAuthState(nextAuth);
        });
        unsubscribeActivity = bridge.onActivityChanged(() => {
          void refresh(generation);
        });
      }
      try {
        const nextAuth = await bridge.getAniListAuthState();
        if (disposed || restoreGeneration !== generation) return;
        await applyAuthState(nextAuth);
      } catch (reason) {
        if (disposed || restoreGeneration !== generation) return;
        restoring = false;
        error = friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "profile data",
          fallback:
            "The saved AniList connection could not be restored. Connect AniList again from Profile.",
        });
        notify();
      }
    },

    async connect() {
      error = undefined;
      notify();
      try {
        await bridge.startAniListLogin();
      } catch (reason) {
        error = friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "sign-in",
          fallback:
            "AniList sign-in could not start. Check your default browser and try connecting again.",
        });
        notify();
      }
    },

    async cancelConnect() {
      error = undefined;
      notify();
      try {
        await bridge.cancelAniListLogin();
      } catch (reason) {
        error = friendlyRemoteError(reason, {
          provider: "AniList",
          operation: "sign-in",
          fallback: "AniList sign-in could not be canceled. You can safely close the browser tab.",
        });
        notify();
      }
    },

    async refresh() {
      await refresh(generation);
    },

    async logout() {
      const previousAuth = auth;
      const previousDashboard = dashboard;
      const previousDashboardVerified = dashboardVerified;
      const previousSyncing = syncing;
      generation += 1;
      auth = { status: "signed-out" };
      dashboard = undefined;
      dashboardRevision += 1;
      dashboardVerified = false;
      syncing = false;
      error = undefined;
      notify();
      try {
        await bridge.logoutAniList();
      } catch (reason) {
        // Keep the local view aligned with the main process. The token may still
        // exist when IPC deletion fails, so do not pretend logout completed.
        generation += 1;
        auth = previousAuth;
        dashboard = previousDashboard;
        dashboardRevision += 1;
        dashboardVerified = previousDashboardVerified;
        syncing = previousSyncing;
        error = messageFrom(reason, "Unable to log out of AniList.");
        notify();
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      restored = false;
      generation += 1;
      unsubscribeAuth?.();
      unsubscribeAuth = undefined;
      unsubscribeActivity?.();
      unsubscribeActivity = undefined;
      listeners.clear();
    },
  };
}
