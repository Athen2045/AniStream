import type { AniStreamBridge } from "../../shared/contracts";
import type { UpdateStatus } from "../../shared/update-check";

type Bridge = Pick<
  AniStreamBridge,
  "getUpdateStatus" | "checkForUpdates" | "onUpdateStatusChanged"
>;
interface Snapshot {
  status: UpdateStatus;
  dismissed: boolean;
  manualPending: boolean;
  error?: string;
}

export function createUpdateSession(bridge: Bridge) {
  let snapshot: Snapshot = {
    status: { kind: "idle", currentVersion: "" },
    dismissed: false,
    manualPending: false,
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
        update({ status, error: undefined });
      });
      try {
        const status = await bridge.getUpdateStatus();
        if (run === generation && initialRevision === revision)
          update({ status, error: undefined });
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
        if (run === generation && initialRevision === revision) update({ status });
      } catch {
        if (run === generation)
          update({ error: "The update check failed. Try again when the app is available." });
      } finally {
        if (run === generation) update({ manualPending: false });
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
      snapshot = { ...snapshot, manualPending: false };
    },
  };
}
