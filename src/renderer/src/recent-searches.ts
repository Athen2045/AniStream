import { useSyncExternalStore } from "react";
import type { SearchScope } from "./SectionSearch";

/**
 * Recent searches per section, kept on this device (user decision 2026-10-20; before, they lasted
 * one session). Settings › General can turn this off, which also deletes them. Nothing here ever
 * leaves the device.
 */
const STORAGE_KEY = "anistream.recent-searches";
export const RECENT_LIMIT = 8;
const MAX_LENGTH = 100;

type RecentSearches = Record<SearchScope, string[]>;

const empty = (): RecentSearches => ({ ANIME: [], MANGA: [], MORE: [] });

export function parseRecentSearches(value: unknown): RecentSearches {
  const result = empty();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const scope of ["ANIME", "MANGA", "MORE"] as const) {
    const list = (value as Record<string, unknown>)[scope];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim().slice(0, MAX_LENGTH);
      const key = trimmed.toLocaleLowerCase();
      if (trimmed.length < 2 || seen.has(key)) continue;
      seen.add(key);
      result[scope].push(trimmed);
      if (result[scope].length >= RECENT_LIMIT) break;
    }
  }
  return result;
}

let current: RecentSearches | undefined;
const listeners = new Set<() => void>();

function read(): RecentSearches {
  if (current) return current;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    current = parseRecentSearches(raw ? JSON.parse(raw) : undefined);
  } catch {
    current = empty();
  }
  return current;
}

function write(next: RecentSearches): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep them for this session only.
  }
  for (const listener of listeners) listener();
}

export function useRecentSearches(scope: SearchScope): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read()[scope],
  );
}

export function addRecentSearch(scope: SearchScope, query: string, remember: boolean): void {
  const trimmed = query.trim().slice(0, MAX_LENGTH);
  if (trimmed.length < 2) return;
  const all = read();
  const list = all[scope].filter(
    (entry) => entry.toLocaleLowerCase() !== trimmed.toLocaleLowerCase(),
  );
  const next = { ...all, [scope]: [trimmed, ...list].slice(0, RECENT_LIMIT) };
  if (remember) write(next);
  else {
    // Not kept on the device: still offered for the rest of this session.
    current = next;
    for (const listener of listeners) listener();
  }
}

export function removeRecentSearch(scope: SearchScope, query: string): void {
  const all = read();
  write({ ...all, [scope]: all[scope].filter((entry) => entry !== query) });
}

/** Clears one section, or every section when no scope is given. */
export function clearRecentSearches(scope?: SearchScope): void {
  if (!scope) {
    current = empty();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
    for (const listener of listeners) listener();
    return;
  }
  write({ ...read(), [scope]: [] });
}
