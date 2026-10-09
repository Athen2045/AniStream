import { useSyncExternalStore } from "react";

/**
 * Titles the viewer removed from a Continue row (user request 2026-10-06). Removal only hides the
 * title from Continue: lists, history, and AniList are untouched. A title returns by itself once
 * it has activity newer than its removal, so watching or reading it again brings it back.
 */
export type ContinueSection = "ANIME" | "MANGA" | "MORE";

const STORAGE_KEY = "anistream.continue.removed";
/** Oldest removals are dropped beyond this; they matter only until the title is touched again. */
const MAX_ENTRIES = 500;

export interface RemovedNotice {
  key: string;
  title: string;
  section: ContinueSection;
  /** Bumps on each removal so a repeat removal of the same title restarts the toast timer. */
  id: number;
}

interface State {
  removed: Readonly<Record<string, number>>;
  notice?: RemovedNotice;
}

export function continueKey(section: ContinueSection, id: string | number): string {
  return `${section}:${id}`;
}

/** True while the removal is newer than the title's latest activity (both in epoch ms). */
export function isRemovedFromContinue(
  removed: Readonly<Record<string, number>>,
  key: string,
  activityAt: number,
): boolean {
  const at = removed[key];
  return at !== undefined && at >= activityAt;
}

export function parseRemoved(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] =>
      /^(ANIME|MANGA|MORE):[\w:-]+$/.test(entry[0]) &&
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1]),
  );
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES));
}

function load(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseRemoved(raw ? JSON.parse(raw) : undefined);
  } catch {
    return {};
  }
}

let state: State | undefined;
let noticeId = 0;
const listeners = new Set<() => void>();

function current(): State {
  state ??= { removed: typeof window === "undefined" ? {} : load() };
  return state;
}

function publish(next: State): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.removed));
  } catch {
    // Storage can be unavailable; the removal then lasts for this session only.
  }
  for (const listener of listeners) listener();
}

export function removeFromContinue(
  section: ContinueSection,
  id: string | number,
  title: string,
  now = Date.now(),
): void {
  const key = continueKey(section, id);
  publish({
    removed: parseRemoved({ ...current().removed, [key]: now }),
    notice: { key, title, section, id: ++noticeId },
  });
}

/** Undo: the title returns to Continue where it was. */
export function restoreToContinue(key: string): void {
  const { [key]: _removed, ...rest } = current().removed;
  void _removed;
  publish({ removed: rest, notice: undefined });
}

export function dismissContinueNotice(id: number): void {
  const { removed, notice } = current();
  if (notice?.id === id) publish({ removed, notice: undefined });
}

export function getRemovedFromContinue(): Readonly<Record<string, number>> {
  return current().removed;
}

export function subscribeContinueRemovals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): State {
  return current();
}

export function useContinueRemovals(): State {
  return useSyncExternalStore(subscribeContinueRemovals, snapshot, snapshot);
}
