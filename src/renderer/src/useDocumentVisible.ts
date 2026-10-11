import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

const visible = (): boolean => document.visibilityState === "visible";

/** False while the window is minimized or hidden, so timers such as hero rotation can rest. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, visible, () => true);
}
