import type { BrowserWindow } from "electron";
import type { UpdateLaunch } from "./update-launch";

/** Embedded player navigation must not invalidate the app document's startup health. */
export function trackUpdateWindowHealth(window: BrowserWindow, launch: UpdateLaunch): void {
  let loaded = false;
  let responsive = true;
  const cancel = (): void => {
    launch.cancelTimer();
  };
  const invalidate = (): void => {
    loaded = false;
    cancel();
  };
  const start = (): void => {
    if (!loaded || !responsive) return;
    launch.rendererLoaded(
      () =>
        loaded &&
        responsive &&
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        !window.webContents.isLoadingMainFrame(),
    );
  };
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) invalidate();
  });
  window.webContents.on("did-finish-load", () => {
    loaded = true;
    start();
  });
  window.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) invalidate();
  });
  window.webContents.on("render-process-gone", invalidate);
  window.on("unresponsive", () => {
    responsive = false;
    cancel();
  });
  window.on("responsive", () => {
    responsive = true;
    start();
  });
  window.on("close", invalidate);
  window.on("closed", invalidate);
}
