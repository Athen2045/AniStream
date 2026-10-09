import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

const WINDOWS_CAPTION_OVERLAY = { color: "#00000000", symbolColor: "#f3f5f7", height: 48 };

/** Native caption controls occupy the renderer's 48px navbar, without a second title bar. */
export function windowChromeOptions(platform: string): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    ...(platform === "darwin"
      ? { trafficLightPosition: { x: 12, y: 16 }, titleBarOverlay: true }
      : {
          titleBarOverlay: WINDOWS_CAPTION_OVERLAY,
          roundedCorners: true,
          backgroundMaterial: "none",
        }),
  };
}

/**
 * Full-window media hides the caption controls with its own auto-hiding controls. Windows
 * cannot remove the overlay at runtime, so its glyphs turn transparent instead.
 */
export function setCaptionControlsVisible(
  window: Pick<BrowserWindow, "setTitleBarOverlay" | "setWindowButtonVisibility">,
  platform: string,
  visible: boolean,
): void {
  if (platform === "darwin") window.setWindowButtonVisibility(visible);
  else
    window.setTitleBarOverlay({
      ...WINDOWS_CAPTION_OVERLAY,
      symbolColor: visible ? WINDOWS_CAPTION_OVERLAY.symbolColor : "#00000000",
    });
}
