import { useSyncExternalStore } from "react";

/**
 * Genres and tags the viewer hid in Settings (user request 2026-10-10). The main process filters
 * For You; the renderer filters what it shows from trending lists with this shared copy.
 */
let names: string[] = [];
let lowered: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: string[]): void {
  names = next;
  lowered = new Set(next.map((name) => name.toLocaleLowerCase()));
  for (const listener of listeners) listener();
}

function load(): void {
  if (loaded || typeof window === "undefined" || !window.anistream) return;
  loaded = true;
  void window.anistream
    .getPersonalizationSettings()
    .then((settings) => publish(settings.hiddenTags ?? []))
    .catch(() => {
      loaded = false;
    });
}

/** Saves a new list and updates every view at once; resolves with the saved list. */
export async function saveHiddenTags(next: string[]): Promise<string[]> {
  const settings = await window.anistream.setHiddenTags(next);
  publish(settings.hiddenTags);
  return settings.hiddenTags;
}

function subscribe(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The hidden names as the viewer typed them (for Settings). */
export function useHiddenTagNames(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => names,
    () => names,
  );
}

/** Lower-cased hidden names, for filtering. */
export function useHiddenTags(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => lowered,
    () => lowered,
  );
}

/** True when any genre of a title is hidden. */
export function hasHiddenGenre(genres: readonly string[], hidden: ReadonlySet<string>): boolean {
  return hidden.size > 0 && genres.some((genre) => hidden.has(genre.toLocaleLowerCase()));
}
