import { expect, it, vi } from "vitest";
import { createUpdateSession } from "../../src/renderer/src/update-session";
import type { UpdatePreferences, UpdateStatus } from "../../src/shared/update-check";

const idle: UpdateStatus = { kind: "idle", currentVersion: "0.1.3" };
const available: UpdateStatus = {
  kind: "update-available",
  currentVersion: "0.1.3",
  version: "0.1.4",
  releaseUrl: "https://github.com/Athen2045/AniStream/releases/tag/v0.1.4",
  checkedAt: "2026-09-09T00:00:00Z",
  retryAt: "2026-09-09T00:01:00Z",
  canInstall: true,
};
const preferences: UpdatePreferences = {
  supported: true,
  autoDownload: true,
  installOnQuit: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let callback: (status: UpdateStatus) => void = () => {};
  const unsubscribe = vi.fn();
  const bridge = {
    getUpdateStatus: vi.fn(async () => idle),
    checkForUpdates: vi.fn(async () => available),
    onUpdateStatusChanged: vi.fn((listener: typeof callback) => {
      callback = listener;
      return unsubscribe;
    }),
    downloadUpdate: vi.fn(async (): Promise<UpdateStatus> => ({
      kind: "downloading",
      currentVersion: "0.1.3",
      version: "0.1.4",
      releaseUrl: available.kind === "update-available" ? available.releaseUrl : "",
      percent: 0,
      transferredBytes: 0,
      totalBytes: 0,
    })),
    cancelUpdateDownload: vi.fn(async () => available),
    installUpdate: vi.fn(async () => true),
    getUpdatePreferences: vi.fn(async () => preferences),
    setUpdatePreferences: vi.fn(async (next: Omit<UpdatePreferences, "supported">) => ({
      supported: true,
      ...next,
    })),
  };
  return {
    bridge,
    unsubscribe,
    emit: (value: UpdateStatus) => callback(value),
    session: createUpdateSession(bridge),
  };
}
it("does not overwrite a newer event with the initial snapshot", async () => {
  const { bridge, session, emit } = setup();
  const late = deferred<UpdateStatus>();
  bridge.getUpdateStatus.mockReturnValueOnce(late.promise);
  const pending = session.activate();
  emit(available);
  late.resolve(idle);
  await pending;
  expect(session.getSnapshot().status).toEqual(available);
});
it("shares dismissal and manual state across subscribers without resubscribing", async () => {
  const { session, bridge } = setup();
  const first = vi.fn(),
    second = vi.fn();
  const unsubscribeFirst = session.subscribe(first);
  await session.activate();
  session.dismiss();
  unsubscribeFirst();
  session.subscribe(second);
  await session.activate();
  await session.check();
  expect(session.getSnapshot()).toMatchObject({
    status: available,
    dismissed: true,
    manualPending: false,
  });
  expect(bridge.onUpdateStatusChanged).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalled();
});
it("deduplicates manual checks and keeps a later event over the invoke result", async () => {
  const { session, bridge, emit } = setup();
  await session.activate();
  const late = deferred<UpdateStatus>();
  bridge.checkForUpdates.mockReturnValueOnce(late.promise);
  const pending = session.check();
  await session.check();
  expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  emit(available);
  late.resolve(idle);
  await pending;
  expect(session.getSnapshot()).toMatchObject({ status: available, manualPending: false });
});
it("allows retry after IPC failures and disposes subscriptions", async () => {
  const { session, bridge, unsubscribe } = setup();
  bridge.getUpdateStatus.mockRejectedValueOnce(new Error("IPC"));
  await session.activate();
  expect(session.getSnapshot().error).toContain("could not be loaded");
  bridge.checkForUpdates.mockRejectedValueOnce(new Error("IPC"));
  await session.check();
  expect(session.getSnapshot()).toMatchObject({
    manualPending: false,
    error: expect.stringContaining("failed"),
  });
  await session.check();
  expect(session.getSnapshot().error).toBeUndefined();
  session.dispose();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("ignores late work after disposal and reactivation", async () => {
  const { session, bridge } = setup();
  const late = deferred<UpdateStatus>();
  bridge.getUpdateStatus.mockReturnValueOnce(late.promise);
  const initial = session.activate();
  session.dispose();
  await session.activate();
  late.resolve(available);
  await initial;
  expect(session.getSnapshot().status).toEqual(idle);
  const manual = deferred<UpdateStatus>();
  bridge.checkForUpdates.mockReturnValueOnce(manual.promise);
  const pending = session.check();
  session.dispose();
  manual.resolve(available);
  await pending;
  expect(session.getSnapshot()).toMatchObject({ status: idle, manualPending: false });
});

const ready: UpdateStatus = {
  kind: "ready-to-install",
  currentVersion: "0.1.3",
  version: "0.1.4",
  releaseUrl: "https://github.com/Athen2045/AniStream/releases/tag/v0.1.4",
};

it("loads update preferences and saves changes", async () => {
  const { bridge, session } = setup();
  await session.activate();
  await vi.waitFor(() => expect(session.getSnapshot().preferences).toEqual(preferences));
  await session.setPreferences({ autoDownload: false, installOnQuit: true });
  expect(bridge.setUpdatePreferences).toHaveBeenCalledWith({
    autoDownload: false,
    installOnQuit: true,
  });
  expect(session.getSnapshot().preferences).toEqual({
    supported: true,
    autoDownload: false,
    installOnQuit: true,
  });
});

it("reports a failed preference save without dropping the previous value", async () => {
  const { bridge, session } = setup();
  bridge.setUpdatePreferences.mockRejectedValueOnce(new Error("no"));
  await session.activate();
  await vi.waitFor(() => expect(session.getSnapshot().preferences).toEqual(preferences));
  await session.setPreferences({ autoDownload: false, installOnQuit: false });
  expect(session.getSnapshot().preferences).toEqual(preferences);
  expect(session.getSnapshot().preferencesError).toBe("The setting could not be saved.");
});

it("starts one download at a time and applies the returned status", async () => {
  const { bridge, session } = setup();
  await session.activate();
  const pending = deferred<UpdateStatus>();
  bridge.downloadUpdate.mockImplementationOnce(() => pending.promise);
  const first = session.download();
  void session.download();
  expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().actionPending).toBe(true);
  pending.resolve(ready);
  await first;
  expect(session.getSnapshot()).toMatchObject({ status: ready, actionPending: false });
});

it("explains when install is refused or the bridge fails", async () => {
  const { bridge, session } = setup();
  await session.activate();
  bridge.installUpdate.mockResolvedValueOnce(false);
  await session.install();
  expect(session.getSnapshot().error).toBe("The update is not ready to install yet.");
  bridge.installUpdate.mockRejectedValueOnce(new Error("ipc"));
  await session.install();
  expect(session.getSnapshot().error).toBe("AniStream could not start the installer. Try again.");
});

it("brings a dismissed notice back when the download becomes ready", async () => {
  const { session, emit } = setup();
  await session.activate();
  emit(available);
  session.dismiss();
  expect(session.getSnapshot().dismissed).toBe(true);
  emit(ready);
  expect(session.getSnapshot().dismissed).toBe(false);
  session.dismiss();
  emit(ready);
  expect(session.getSnapshot().dismissed).toBe(true);
});
