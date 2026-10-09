import { useSyncExternalStore } from "react";

export type StartSection = "ANIME" | "MANGA" | "MORE";
export type AudioPreference = "sub" | "dub";

/** Per-device app choices from Settings (user request 2026-10-06). */
export interface AppPreferences {
  /** Up Next queue and playlists: navbar button, title-page menu, and queue autoplay. */
  upNext: boolean;
  /** The navbar's airing-schedule button. */
  schedule: boolean;
  /** For You rails on Anime, Manga and More. */
  forYou: boolean;
  /** The Latest Updates grid on Anime and Manga (user request 2026-10-06). */
  latestUpdates: boolean;
  /** Home heroes advance on their own. */
  heroRotate: boolean;
  /** Fewer animations, on every platform. */
  reduceMotion: boolean;
  /** The section the app opens on. */
  startSection: StartSection;
  /** Preferred audio when an episode offers both. */
  audio: AudioPreference;
}

export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = {
  upNext: true,
  schedule: true,
  forYou: true,
  latestUpdates: true,
  heroRotate: true,
  reduceMotion: false,
  startSection: "ANIME",
  audio: "sub",
};

const STORAGE_KEY = "anistream.preferences";

/** Keeps each valid field and falls back to the default for anything missing or malformed. */
export function parseAppPreferences(value: unknown): AppPreferences {
  const row =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const flag = (key: keyof AppPreferences): boolean =>
    typeof row[key] === "boolean"
      ? (row[key] as boolean)
      : (DEFAULT_APP_PREFERENCES[key] as boolean);
  return {
    upNext: flag("upNext"),
    schedule: flag("schedule"),
    forYou: flag("forYou"),
    latestUpdates: flag("latestUpdates"),
    heroRotate: flag("heroRotate"),
    reduceMotion: flag("reduceMotion"),
    startSection:
      row.startSection === "ANIME" || row.startSection === "MANGA" || row.startSection === "MORE"
        ? row.startSection
        : DEFAULT_APP_PREFERENCES.startSection,
    audio: row.audio === "sub" || row.audio === "dub" ? row.audio : DEFAULT_APP_PREFERENCES.audio,
  };
}

function load(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseAppPreferences(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

let current: AppPreferences | undefined;
const listeners = new Set<() => void>();

function applyMotion(preferences: AppPreferences): void {
  if (typeof document === "undefined") return;
  if (preferences.reduceMotion) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
}

export function getAppPreferences(): AppPreferences {
  if (!current) {
    current = typeof window === "undefined" ? { ...DEFAULT_APP_PREFERENCES } : load();
    applyMotion(current);
  }
  return current;
}

export function setAppPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): void {
  current = { ...getAppPreferences(), [key]: value };
  applyMotion(current);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppPreferences(): AppPreferences {
  return useSyncExternalStore(subscribe, getAppPreferences, getAppPreferences);
}

/** Picks the embed matching the preferred audio; the first one when none matches. */
export function preferredAudioSource<T extends { label: string }>(
  sources: readonly T[],
  audio: AudioPreference,
): T | undefined {
  const pattern = audio === "dub" ? /\bdub/i : /\bsub/i;
  return sources.find((source) => pattern.test(source.label)) ?? sources[0];
}
