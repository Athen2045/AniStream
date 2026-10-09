import { useEffect } from "react";

function setCaptionControls(visible: boolean): void {
  void window.anistream.setCaptionControlsVisible(visible).catch(() => undefined);
}

/**
 * Full-window media covers the navbar the native window controls normally sit in, so while
 * `active` they follow the surface's auto-hiding controls, and return when it closes.
 */
export function useCaptionControlsVisibility(active: boolean, controlsVisible: boolean) {
  const shown = !active || controlsVisible;
  useEffect(() => setCaptionControls(shown), [shown]);
  useEffect(() => () => setCaptionControls(true), []);
}
