import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import type { WindowControlAction } from "../shared/contracts";

/**
 * macOS keeps its native traffic lights. Windows has no native caption buttons: the renderer
 * draws minimise / maximise / close in a glass pill and a thin drag strip along the top
 * (TV-style rail, user decision 2026-10-20), so the window has no title bar of its own.
 */
export function windowChromeOptions(platform: string): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    ...(platform === "darwin"
      ? { trafficLightPosition: { x: 10, y: 14 }, titleBarOverlay: true }
      : { roundedCorners: true, backgroundMaterial: "none" }),
  };
}

/**
 * Full-window media hides the caption controls with its own auto-hiding controls. Only macOS
 * has native ones to hide; on Windows the renderer hides its own.
 */
export function setCaptionControlsVisible(
  window: Pick<BrowserWindow, "setWindowButtonVisibility">,
  platform: string,
  visible: boolean,
): void {
  if (platform === "darwin") window.setWindowButtonVisibility(visible);
}

export function controlWindow(
  window: Pick<BrowserWindow, "minimize" | "maximize" | "unmaximize" | "isMaximized" | "close">,
  action: WindowControlAction,
): void {
  if (action === "minimize") window.minimize();
  else if (action === "close") window.close();
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}
