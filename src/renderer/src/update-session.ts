import type { AniStreamBridge } from "../../shared/contracts";
import type { UpdatePreferences, UpdateStatus } from "../../shared/update-check";

type Bridge = Pick<
  AniStreamBridge,
  | "getUpdateStatus"
  | "checkForUpdates"
  | "onUpdateStatusChanged"
  | "downloadUpdate"
  | "cancelUpdateDownload"
  | "installUpdate"
  | "getUpdatePreferences"
  | "setUpdatePreferences"
>;
interface Snapshot {
  status: UpdateStatus;
  dismissed: boolean;
  manualPending: boolean;
  /** A download/cancel/install request is in flight. */
  actionPending: boolean;
  preferences?: UpdatePreferences;
  preferencesError?: string;
  error?: string;
}

export function createUpdateSession(bridge: Bridge) {
  let snapshot: Snapshot = {
    status: { kind: "idle", currentVersion: "" },
    dismissed: false,
    manualPending: false,
    actionPending: false,
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let revision = 0;
  let active = false;
  let unsubscribe: (() => void) | undefined;
  const update = (patch: Partial<Snapshot>): void => {
    if (!active) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  // A finished download is news even if an earlier "available" notice was dismissed.
  const setStatus = (status: UpdateStatus, patch: Partial<Snapshot> = {}): void => {
    const becameReady =
      status.kind === "ready-to-install" && snapshot.status.kind !== "ready-to-install";
    update({ status, ...(becameReady ? { dismissed: false } : {}), ...patch });
  };
  const action = async (
    run: () => Promise<UpdateStatus | boolean>,
    failure: string,
  ): Promise<void> => {
    if (!active || snapshot.actionPending) return;
    const current = generation;
    update({ actionPending: true, error: undefined });
    try {
      const result = await run();
      if (current !== generation) return;
      if (typeof result === "boolean") {
        if (!result) update({ error: "The update is not ready to install yet." });
      } else setStatus(result);
    } catch {
      if (current === generation) update({ error: failure });
    } finally {
      if (current === generation) update({ actionPending: false });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async activate(): Promise<void> {
      if (active) return;
      active = true;
      const run = ++generation;
      const initialRevision = revision;
      unsubscribe = bridge.onUpdateStatusChanged((status) => {
        revision++;
        setStatus(status, { error: undefined });
      });
      void bridge
        .getUpdatePreferences()
        .then((preferences) => run === generation && update({ preferences }))
        .catch(() => undefined);
      try {
        const status = await bridge.getUpdateStatus();
        if (run === generation && initialRevision === revision)
          setStatus(status, { error: undefined });
      } catch {
        if (run === generation && initialRevision === revision)
          update({ error: "Update status could not be loaded. Try checking again." });
      }
    },
    async check(): Promise<void> {
      if (!active || snapshot.manualPending) return;
      const run = generation;
      const initialRevision = revision;
      update({ manualPending: true, error: undefined });
      try {
        const status = await bridge.checkForUpdates();
        if (run === generation && initialRevision === revision) setStatus(status);
      } catch {
        if (run === generation)
          update({ error: "The update check failed. Try again when the app is available." });
      } finally {
        if (run === generation) update({ manualPending: false });
      }
    },
    download: () =>
      action(() => bridge.downloadUpdate(), "The download could not start. Try again."),
    cancelDownload: () =>
      action(() => bridge.cancelUpdateDownload(), "The download could not be stopped."),
    install: () =>
      action(() => bridge.installUpdate(), "AniStream could not start the installer. Try again."),
    async setPreferences(next: Omit<UpdatePreferences, "supported">): Promise<void> {
      if (!active) return;
      const run = generation;
      update({ preferencesError: undefined });
      try {
        const preferences = await bridge.setUpdatePreferences(next);
        if (run === generation) update({ preferences });
      } catch {
        if (run === generation) update({ preferencesError: "The setting could not be saved." });
      }
    },
    dismiss() {
      update({ dismissed: true });
    },
    dispose() {
      active = false;
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      snapshot = { ...snapshot, manualPending: false, actionPending: false };
    },
  };
}
