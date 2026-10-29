import { app, shell, type BrowserWindow } from "electron";
import type { AppInfo } from "../../shared/contracts";
import type { AniListClient } from "../anilist";
import { setPreferEnglishTitles } from "../anilist/title-preference";
import type { BackgroundMode } from "../background-mode";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import { controlWindow, setCaptionControlsVisible } from "../window-chrome";

/** App-level IPC: app info, links, title language, background mode and the window controls. */
export function registerAppHandlers(
  trustedRendererOrigin: string,
  options: {
    database: AppDatabase;
    background: BackgroundMode;
    aniList: AniListClient;
    window: () => BrowserWindow | undefined;
    videoSourceConfigured: boolean;
  },
): void {
  const { database, background, aniList } = options;
  const openWindow = (): BrowserWindow | undefined => {
    const window = options.window();
    return window && !window.isDestroyed() ? window : undefined;
  };
  const titlePreferences = database.titlePreferences;
  registerTrustedIpcHandler(trustedRendererOrigin, "app:title-preferences", () =>
    titlePreferences.read(),
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "app:set-title-preferences",
    (_event, preferences) => {
      titlePreferences.write(preferences);
      setPreferEnglishTitles(preferences.english);
      // Cached AniList responses still carry the old titles; the renderer reloads after this.
      aniList.clearCachedResponses();
      return titlePreferences.read();
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "app:get-info", (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    databaseReady: database.ready,
    videoSourceStatus: options.videoSourceConfigured ? "configured" : "unavailable",
  }));
  registerTrustedIpcHandler(trustedRendererOrigin, "app:open-link", (_, url) =>
    shell.openExternal(url),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "app:background-preferences", () =>
    background.preferencesNow(),
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "app:set-background-preferences",
    (_, preferences) => database.backgroundPreferences.write(preferences),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "window:caption-controls", (_, visible) => {
    const window = openWindow();
    if (window) setCaptionControlsVisible(window, process.platform, visible);
  });
  // The renderer draws its own window controls on Windows (TV-style rail, 2026-10-20).
  registerTrustedIpcHandler(trustedRendererOrigin, "window:control", (_, action) => {
    const window = openWindow();
    if (window) controlWindow(window, action);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "window:state", () => {
    const window = openWindow();
    return {
      maximized: Boolean(window?.isMaximized()),
      fullScreen: Boolean(window?.isFullScreen()),
    };
  });
}
