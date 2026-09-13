import type { BrowserWindowConstructorOptions } from "electron";

/** Native caption controls occupy the renderer's 48px navbar, without a second title bar. */
export function windowChromeOptions(platform: string): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: "hidden",
    ...(platform === "darwin"
      ? { trafficLightPosition: { x: 12, y: 16 }, titleBarOverlay: true }
      : {
          titleBarOverlay: { color: "#00000000", symbolColor: "#f3f5f7", height: 48 },
          roundedCorners: true,
          backgroundMaterial: "none",
        }),
  };
}
