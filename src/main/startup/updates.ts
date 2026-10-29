import { app, type BrowserWindow } from "electron";
import type { BackgroundMode } from "../background-mode";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler, sendTypedIpcEvent } from "../ipc";
import { UpdateChecker } from "../update-check";
import { WindowsUpdateInstaller, type UpdaterAdapter } from "../update-install";
import { UpdateLaunch } from "../update-launch";
import { updateTarget } from "../update-release";
import { UpdateService } from "../update-service";

/**
 * Update checks, the Windows in-app installer and the post-update launch check, with their IPC
 * handlers. macOS keeps the release link (Squirrel.Mac requires a signed app).
 */
export function setupUpdates(
  trustedRendererOrigin: string,
  options: {
    database: AppDatabase;
    background: BackgroundMode;
    window: () => BrowserWindow | undefined;
  },
): { launch: UpdateLaunch; service: UpdateService; checker: UpdateChecker } {
  const { database, background } = options;
  const target = updateTarget(app.isPackaged, process.platform, process.arch);
  const launch = new UpdateLaunch(database.updateLaunch, app.getVersion(), target !== undefined);
  // The service is assigned before any check can run, so these callbacks always reach it.
  let service: UpdateService | undefined;
  const checker = new UpdateChecker({
    currentVersion: app.getVersion(),
    target,
    recovery: launch.recovery,
    onChange: () => service?.handleChange(),
  });
  const preferences = database.updatePreferences;
  // In-app download/install is Windows x64 only.
  const installer =
    target === "win-x64"
      ? new WindowsUpdateInstaller({
          factory: createWindowsUpdater,
          installOnQuit: preferences.read().installOnQuit,
          onChange: () => service?.handleChange(),
        })
      : undefined;
  const updates = new UpdateService({
    checker,
    installer,
    preferences,
    onChange: (state) => {
      const window = options.window();
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
        sendTypedIpcEvent(window.webContents, "app:update-status-changed", state);
    },
  });
  service = updates;
  registerTrustedIpcHandler(trustedRendererOrigin, "app:update-status", () => updates.getStatus());
  registerTrustedIpcHandler(trustedRendererOrigin, "app:check-updates", () => updates.check());
  registerTrustedIpcHandler(trustedRendererOrigin, "app:download-update", () => updates.download());
  registerTrustedIpcHandler(trustedRendererOrigin, "app:cancel-update-download", () =>
    updates.cancelDownload(),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "app:install-update", () => {
    // The updater closes the window before the app's quit signal: let that close through.
    background.markQuitting();
    return updates.install();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "app:update-preferences", () =>
    updates.getPreferences(),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "app:set-update-preferences", (_event, next) =>
    updates.setPreferences(next),
  );
  return { launch, service: updates, checker };
}

/** electron-updater, loaded only in packaged Windows builds and pinned to one release's assets. */
async function createWindowsUpdater(feedUrl: string) {
  const { NsisUpdater, CancellationToken } = await import("electron-updater");
  const updater = new NsisUpdater({ provider: "generic", url: feedUrl });
  // Keep the console quiet: no per-request info logging, only problems.
  updater.logger = {
    info: () => undefined,
    warn: (message: unknown) => console.warn("AniStream updater:", message),
    error: (message: unknown) => console.error("AniStream updater:", message),
  };
  // NsisUpdater's typed emitter and CancellationToken class are wider than the adapter slice.
  return {
    updater: updater as unknown as UpdaterAdapter,
    createToken: () => new CancellationToken(),
  };
}
