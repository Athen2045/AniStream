import type { SavePlaybackResumeInput } from "../../shared/contracts";
import { parseMegaPlayEvent } from "../../shared/megaplay-events";

const MEGAPLAY_ORIGIN = "https://megaplay.buzz";
const RESUME_SAVE_INTERVAL_MS = 10_000;
const PLAYER_LOAD_TIMEOUT_MS = 15_000;
const COMPLETE_PERCENT = 90;

export interface AnimePlaybackSessionSnapshot {
  loaded: boolean;
  hasProgressed: boolean;
  loadTimedOut: boolean;
  hasError: boolean;
  errorMessage?: string;
  ended: boolean;
}

export interface AnimePlaybackSessionOptions {
  mediaId: number;
  episode: number;
  saveResume: (input: SavePlaybackResumeInput) => Promise<void> | void;
  clearResume: (aniListId: number) => Promise<void> | void;
  onWatched: (episode: number) => Promise<void> | void;
  now?: () => number;
  loadTimeoutMs?: number;
}

export interface AnimePlaybackSession {
  getSnapshot(): AnimePlaybackSessionSnapshot;
  subscribe(listener: () => void): () => void;
  markLoaded(): void;
  handleMessage(
    data: unknown,
    origin: string,
    source: MessageEventSource | null,
    expectedSource: MessageEventSource | null,
  ): void;
  dispose(): void;
}

export function createAnimePlaybackSession(
  options: AnimePlaybackSessionOptions,
): AnimePlaybackSession {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: AnimePlaybackSessionSnapshot = {
    loaded: false,
    hasProgressed: false,
    loadTimedOut: false,
    hasError: false,
    ended: false,
  };
  let latestProgress: { currentTime: number; duration: number } | undefined;
  let lastSavedAt = 0;
  let completed = false;
  let disposed = false;

  const timer = setTimeout(() => {
    if (!disposed && !snapshot.loaded) updateSnapshot({ loadTimedOut: true });
  }, options.loadTimeoutMs ?? PLAYER_LOAD_TIMEOUT_MS);

  const updateSnapshot = (changes: Partial<AnimePlaybackSessionSnapshot>): void => {
    snapshot = { ...snapshot, ...changes };
    for (const listener of listeners) listener();
  };

  const persistLatest = (force: boolean): void => {
    if (!latestProgress) return;
    const timestamp = now();
    if (!force && timestamp - lastSavedAt < RESUME_SAVE_INTERVAL_MS) return;
    lastSavedAt = timestamp;
    const input: SavePlaybackResumeInput = {
      aniListId: options.mediaId,
      episode: options.episode,
      positionSeconds: Math.max(0, latestProgress.currentTime),
      durationSeconds: latestProgress.duration,
    };
    void Promise.resolve(options.saveResume(input)).catch(() => undefined);
  };

  const markWatched = (): void => {
    if (completed) return;
    completed = true;
    latestProgress = undefined;
    void Promise.resolve(options.clearResume(options.mediaId)).catch(() => undefined);
    void Promise.resolve(options.onWatched(options.episode)).catch(() => undefined);
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    markLoaded() {
      if (!disposed) updateSnapshot({ loaded: true });
    },

    handleMessage(data, origin, source, expectedSource) {
      if (
        disposed ||
        origin !== MEGAPLAY_ORIGIN ||
        expectedSource === null ||
        source !== expectedSource
      ) {
        return;
      }

      const message = parseMegaPlayEvent(data);
      if (!message) return;

      if (message.kind === "progress") {
        updateSnapshot({ hasProgressed: true });
        const ratio = message.percent ?? (message.currentTime / message.duration) * 100;
        if (ratio >= COMPLETE_PERCENT) {
          markWatched();
          return;
        }
        if (!completed) {
          latestProgress = {
            currentTime: message.currentTime,
            duration: message.duration,
          };
          persistLatest(false);
        }
        return;
      }

      if (message.kind === "complete") {
        updateSnapshot({ ended: true });
        markWatched();
        return;
      }

      updateSnapshot({
        hasError: true,
        errorMessage: message.message ?? "The Anikoto player reported a playback error.",
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      if (!completed) persistLatest(true);
      listeners.clear();
    },
  };
}
