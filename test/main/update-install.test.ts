import { describe, expect, it, vi } from "vitest";
import {
  failureReason,
  WindowsUpdateInstaller,
  type DownloadProgress,
  type UpdaterAdapter,
} from "../../src/main/update-install";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeUpdater(manifestVersion = "2.1.0") {
  let progress: (value: DownloadProgress) => void = () => undefined;
  const download = deferred<unknown>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableDifferentialDownload: false,
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: manifestVersion } })),
    downloadUpdate: vi.fn(() => download.promise),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (value: never) => void) => {
      if (event === "download-progress") progress = listener as typeof progress;
      return updater;
    }),
    removeAllListeners: vi.fn(),
  };
  return {
    updater: updater as typeof updater & UpdaterAdapter,
    download,
    progress: (value: DownloadProgress) => progress(value),
  };
}

function setup(manifestVersion?: string, options: { installOnQuit?: boolean } = {}) {
  const fake = fakeUpdater(manifestVersion);
  const token = { cancel: vi.fn() };
  const factory = vi.fn(async () => ({ updater: fake.updater, createToken: () => token }));
  let clock = 0;
  const onChange = vi.fn();
  const installer = new WindowsUpdateInstaller({
    factory,
    onChange,
    installOnQuit: options.installOnQuit,
    now: () => clock,
  });
  return { ...fake, token, factory, installer, onChange, tick: (ms: number) => (clock += ms) };
}

describe("WindowsUpdateInstaller", () => {
  it("pins the feed to the release and configures the updater conservatively", async () => {
    const { installer, factory, updater, download } = setup();
    const pending = installer.download("2.1.0");
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalled());
    expect(factory).toHaveBeenCalledWith(
      "https://github.com/Athen2045/AniStream/releases/download/v2.1.0",
    );
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      allowDowngrade: false,
      disableDifferentialDownload: true,
    });
    download.resolve(["installer.exe"]);
    expect(await pending).toEqual({ phase: "ready", version: "2.1.0" });
  });

  it("reports throttled progress while downloading", async () => {
    const { installer, updater, progress, tick, download } = setup();
    const pending = installer.download("2.1.0");
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalled());
    tick(1000);
    progress({ percent: 12.5, transferred: 1250, total: 10000 });
    tick(100);
    progress({ percent: 13, transferred: 1300, total: 10000 });
    expect(installer.getState()).toEqual({
      phase: "downloading",
      version: "2.1.0",
      percent: 12.5,
      transferredBytes: 1250,
      totalBytes: 10000,
    });
    tick(300);
    progress({ percent: 250, transferred: -1, total: Number.NaN });
    expect(installer.getState()).toMatchObject({
      percent: 100,
      transferredBytes: 0,
      totalBytes: 0,
    });
    download.resolve([]);
    await pending;
  });

  it("refuses a manifest for a different version without downloading", async () => {
    const { installer, updater } = setup("2.2.0");
    expect(await installer.download("2.1.0")).toEqual({
      phase: "failed",
      version: "2.1.0",
      reason: "version-mismatch",
    });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("treats an empty check result as a version mismatch", async () => {
    const { installer, updater } = setup();
    updater.checkForUpdates.mockResolvedValueOnce(null as never);
    expect(await installer.download("2.1.0")).toMatchObject({ reason: "version-mismatch" });
  });

  it.each([
    [new Error("sha512 checksum mismatch, expected abc, got def"), "integrity"],
    [Object.assign(new Error("no space"), { code: "ENOSPC" }), "disk"],
    [new Error("net::ERR_INTERNET_DISCONNECTED"), "network"],
    [
      Object.assign(new Error("missing"), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" }),
      "network",
    ],
    [new Error("something odd"), "unknown"],
  ] as const)("classifies a failed download (%#)", async (error, reason) => {
    const { installer, download } = setup();
    const pending = installer.download("2.1.0");
    download.reject(error);
    expect(await pending).toEqual({ phase: "failed", version: "2.1.0", reason });
  });

  it("shares a concurrent request for the same version and retries after failure", async () => {
    const { installer, factory, updater, download } = setup();
    const first = installer.download("2.1.0");
    const second = installer.download("2.1.0");
    expect(second).toBe(first);
    download.reject(new Error("net::ERR_CONNECTION_RESET"));
    await first;
    expect(factory).toHaveBeenCalledTimes(1);
    updater.downloadUpdate.mockResolvedValueOnce([]);
    expect(await installer.download("2.1.0")).toEqual({ phase: "ready", version: "2.1.0" });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("cancels an active download back to idle and ignores its late result", async () => {
    const { installer, updater, token, download } = setup();
    const pending = installer.download("2.1.0");
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalled());
    installer.cancel();
    expect(token.cancel).toHaveBeenCalled();
    expect(updater.removeAllListeners).toHaveBeenCalled();
    expect(installer.getState()).toEqual({ phase: "idle" });
    download.resolve([]);
    await pending;
    expect(installer.getState()).toEqual({ phase: "idle" });
  });

  it("installs silently and relaunches only when ready", async () => {
    const { installer, updater, download } = setup();
    expect(installer.install()).toBe(false);
    const pending = installer.download("2.1.0");
    download.resolve([]);
    await pending;
    expect(installer.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("applies install-on-quit before and after the updater exists", async () => {
    const { installer, updater, download } = setup(undefined, { installOnQuit: true });
    const pending = installer.download("2.1.0");
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalled());
    expect(updater.autoInstallOnAppQuit).toBe(true);
    installer.setInstallOnQuit(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    download.resolve([]);
    await pending;
  });

  it("stops a partial download on dispose but keeps a ready update armed", async () => {
    const first = setup();
    const pending = first.installer.download("2.1.0");
    await vi.waitFor(() => expect(first.updater.downloadUpdate).toHaveBeenCalled());
    first.installer.dispose();
    expect(first.token.cancel).toHaveBeenCalled();
    first.download.resolve([]);
    await pending;
    expect(first.installer.getState()).toEqual({ phase: "idle" });

    const second = setup(undefined, { installOnQuit: true });
    const ready = second.installer.download("2.1.0");
    second.download.resolve([]);
    await ready;
    second.installer.dispose();
    expect(second.updater.removeAllListeners).not.toHaveBeenCalled();
    expect(second.updater.autoInstallOnAppQuit).toBe(true);
  });

  it("maps unknown values without throwing", () => {
    expect(failureReason("plain string")).toBe("unknown");
    expect(failureReason(undefined)).toBe("unknown");
  });
});
