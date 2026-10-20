import { useEffect, useSyncExternalStore } from "react";

// Windows draws its window controls in the renderer (WindowControls.tsx); macOS keeps native ones.
let captionShown = true;
const listeners = new Set<() => void>();

function setCaptionControls(visible: boolean): void {
  if (captionShown !== visible) {
    captionShown = visible;
    for (const listener of listeners) listener();
  }
  void window.anistream.setCaptionControlsVisible(visible).catch(() => undefined);
}

/** Whether full-window media currently lets the window controls show. */
export function useCaptionControlsShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => captionShown,
  );
}

/**
 * Full-window media covers the area the window controls normally sit in, so while `active` they
 * follow the surface's auto-hiding controls, and return when it closes.
 */
export function useCaptionControlsVisibility(active: boolean, controlsVisible: boolean) {
  const shown = !active || controlsVisible;
  useEffect(() => setCaptionControls(shown), [shown]);
  useEffect(() => () => setCaptionControls(true), []);
}
