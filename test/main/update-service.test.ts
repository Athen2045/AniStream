import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../src/shared/update-check";
import type { InstallState } from "../../src/main/update-install";
import { UpdateService } from "../../src/main/update-service";
import {
  DEFAULT_UPDATE_PREFERENCES,
  type StoredUpdatePreferences,
} from "../../src/main/update-preferences-store";

const available = (version = "2.1.0", canInstall = true): UpdateStatus => ({
  kind: "update-available",
  currentVersion: "2.0.0",
  version,
  releaseUrl: `https://github.com/Athen2045/AniStream/releases/tag/v${version}`,
  checkedAt: "2026-10-10T00:00:00Z",
  retryAt: "2026-10-10T00:01:00Z",
  canInstall,
});

function setup(
  initial: UpdateStatus = { kind: "idle", currentVersion: "2.0.0" },
  preferences: StoredUpdatePreferences = { ...DEFAULT_UPDATE_PREFERENCES },
  withInstaller = true,
) {
  let status = initial;
  let install: InstallState = { phase: "idle" };
  let stored = preferences;
  const checker = {
    getStatus: () => status,
    check: vi.fn(async () => status),
    dispose: vi.fn(),
  };
  const installer = {
    getState: () => install,
    download: vi.fn(async (version: string) => {
      install = { phase: "ready", version };
      return install;
    }),
    cancel: vi.fn(() => {
      install = { phase: "idle" };
    }),
    install: vi.fn(() => install.phase === "ready"),
    setInstallOnQuit: vi.fn(),
    dispose: vi.fn(),
  };
  const store = {
    read: vi.fn(() => stored),
    write: vi.fn((next: StoredUpdatePreferences) => {
      stored = next;
    }),
  };
  const onChange = vi.fn();
  const service = new UpdateService({
    checker,
    installer: withInstaller ? installer : undefined,
    preferences: store,
    onChange,
  });
  return {
    service,
    checker,
    installer,
    store,
    onChange,
    setStatus: (next: UpdateStatus) => (status = next),
    setInstall: (next: InstallState) => (install = next),
  };
}

describe("UpdateService", () => {
  it("downloads an installable release in the background once per version", async () => {
    const { service, installer, setStatus } = setup();
    setStatus(available());
    service.handleChange();
    service.handleChange();
    expect(installer.download).toHaveBeenCalledTimes(1);
    expect(installer.download).toHaveBeenCalledWith("2.1.0");
    await vi.waitFor(() => expect(service.getStatus()).toMatchObject({ kind: "ready-to-install" }));
  });

  it("leaves the download to the user when automatic download is off", () => {
    const { service, installer, setStatus } = setup(undefined, {
      autoDownload: false,
      installOnQuit: false,
    });
    setStatus(available());
    service.handleChange();
    expect(installer.download).not.toHaveBeenCalled();
  });

  it("never downloads releases that cannot be installed in-app", () => {
    const { service, installer, setStatus } = setup();
    setStatus(available("2.1.0", false));
    service.handleChange();
    expect(installer.download).not.toHaveBeenCalled();
  });

  it("maps install phases onto the status with the release link", () => {
    const { service, setStatus, setInstall } = setup();
    setStatus({ kind: "checking", currentVersion: "2.0.0" });
    setInstall({
      phase: "downloading",
      version: "2.1.0",
      percent: 40,
      transferredBytes: 4,
      totalBytes: 10,
    });
    expect(service.getStatus()).toEqual({
      kind: "downloading",
      currentVersion: "2.0.0",
      version: "2.1.0",
      releaseUrl: "https://github.com/Athen2045/AniStream/releases/tag/v2.1.0",
      percent: 40,
      transferredBytes: 4,
      totalBytes: 10,
    });
    setInstall({ phase: "failed", version: "2.1.0", reason: "integrity" });
    expect(service.getStatus()).toMatchObject({ kind: "install-failed", reason: "integrity" });
  });

  it("prefers a newer release over a stale ready download", () => {
    const { service, setStatus, setInstall } = setup();
    setInstall({ phase: "ready", version: "2.1.0" });
    setStatus(available("2.2.0"));
    expect(service.getStatus()).toMatchObject({ kind: "update-available", version: "2.2.0" });
  });

  it("retries a failed download on request", async () => {
    const { service, installer, setStatus, setInstall } = setup(undefined, {
      autoDownload: false,
      installOnQuit: false,
    });
    setStatus(available());
    setInstall({ phase: "failed", version: "2.1.0", reason: "network" });
    expect(await service.download()).toMatchObject({ kind: "ready-to-install" });
    expect(installer.download).toHaveBeenCalledWith("2.1.0");
  });

  it("does nothing for downloads, installs, or preferences without an installer", async () => {
    const { service, store } = setup(available(), undefined, false);
    expect(await service.download()).toMatchObject({ kind: "update-available" });
    expect(service.install()).toBe(false);
    expect(service.getPreferences()).toMatchObject({ supported: false });
    service.setPreferences({ autoDownload: false, installOnQuit: true });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("saves preferences and applies install-on-quit", () => {
    const { service, store, installer } = setup();
    expect(service.setPreferences({ autoDownload: false, installOnQuit: true })).toEqual({
      supported: true,
      autoDownload: false,
      installOnQuit: true,
    });
    expect(store.write).toHaveBeenCalledWith({ autoDownload: false, installOnQuit: true });
    expect(installer.setInstallOnQuit).toHaveBeenCalledWith(true);
  });

  it("falls back to defaults when preferences cannot be read", () => {
    const { service, store } = setup();
    store.read.mockImplementation(() => {
      throw new Error("db");
    });
    expect(service.getPreferences()).toEqual({ supported: true, ...DEFAULT_UPDATE_PREFERENCES });
  });

  it("only notifies when the status actually changes", () => {
    const { service, onChange, setStatus } = setup(undefined, {
      autoDownload: false,
      installOnQuit: false,
    });
    service.handleChange();
    service.handleChange();
    expect(onChange).toHaveBeenCalledTimes(1);
    setStatus(available());
    service.handleChange();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
