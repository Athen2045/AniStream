import type { SavePlaybackResumeInput } from "../../shared/contracts";
import { parseAnimePlayerMessage } from "../../shared/anime-player-events";
import { friendlyPlaybackError } from "./remote-error";

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
  persistenceError?: string;
  /** Where the player is, in whole seconds (updates once a second while it plays). */
  position?: { seconds: number; duration: number };
  /** The audio the player says it plays (players that report it), e.g. sub when no dub exists. */
  language?: "sub" | "dub";
}

export interface AnimePlaybackSessionOptions {
  mediaId: number;
  /** Origin of the embed URL main returned; messages from any other origin are ignored. */
  playerOrigin: string;
  episode: number;
  /** Event format of players that report `{ source, type: "event", name, data }`. */
  eventSource?: string;
  saveResume: (input: SavePlaybackResumeInput) => Promise<void> | void;
  clearResume: (aniListId: number) => Promise<void> | void;
  onWatched: (episode: number) => Promise<void> | void;
  /** The viewer pressed the player's own previous / next episode button. */
  onNavigate?: (direction: "previous" | "next") => void;
  /** The viewer changed the audio in the player's own menu after it started playing. */
  onAudioChosen?: (language: "sub" | "dub") => void;
  now?: () => number;
  loadTimeoutMs?: number;
}

export interface AnimePlaybackSession {
  activate(): void;
  getSnapshot(): AnimePlaybackSessionSnapshot;
  subscribe(listener: () => void): () => void;
  markLoaded(): void;
  /** Records the episode as watched now (e.g. when the viewer skips its ending to the next). */
  markWatched(): void;
  retryPersistence(): void;
  handleMessage(
    data: unknown,
    origin: string,
    source: MessageEventSource | null,
    expectedSource: MessageEventSource | null,
  ): void;
  dispose(): void;
  /** Replaces the episode-button and audio callbacks (they follow the page's episode list). */
  setPlayerCallbacks(
    callbacks: Pick<AnimePlaybackSessionOptions, "onNavigate" | "onAudioChosen">,
  ): void;
}

export function chooseInitialAnimeEpisode(input: {
  requestedEpisode: number;
  savedEpisode?: number;
  completedProgress: number;
  totalEpisodes?: number;
  /**
   * A specific episode was chosen (an episode tile, Downloads, Up Next, a Continue card): play
   * exactly that one. Without it the request is a minimum and progress may move it forward.
   */
  exact?: boolean;
}): number {
  if (input.exact) {
    const chosen = Math.max(1, input.requestedEpisode);
    return input.totalEpisodes ? Math.min(input.totalEpisodes, chosen) : chosen;
  }
  const progressTarget = Math.max(1, input.requestedEpisode, input.completedProgress + 1);
  const selected =
    input.savedEpisode !== undefined && input.savedEpisode >= progressTarget
      ? input.savedEpisode
      : progressTarget;
  return input.totalEpisodes ? Math.min(input.totalEpisodes, selected) : selected;
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
  let completionRequested = false;
  let completing = false;
  let disposed = false;
  let callbacks: Pick<AnimePlaybackSessionOptions, "onNavigate" | "onAudioChosen"> = {
    onNavigate: options.onNavigate,
    onAudioChosen: options.onAudioChosen,
  };

  const startLoadTimer = () =>
    setTimeout(() => {
      if (!disposed && !snapshot.hasProgressed && !snapshot.ended)
        updateSnapshot({ loadTimedOut: true });
    }, options.loadTimeoutMs ?? PLAYER_LOAD_TIMEOUT_MS);
  let timer = startLoadTimer();

  const updateSnapshot = (changes: Partial<AnimePlaybackSessionSnapshot>): void => {
    const keys = Object.keys(changes) as (keyof AnimePlaybackSessionSnapshot)[];
    if (keys.every((key) => snapshot[key] === changes[key])) return;
    snapshot = { ...snapshot, ...changes };
    for (const listener of listeners) listener();
  };

  const persistLatest = (force: boolean): void => {
    if (!latestProgress || completionRequested) return;
    const timestamp = now();
    if (!force && timestamp - lastSavedAt < RESUME_SAVE_INTERVAL_MS) return;
    lastSavedAt = timestamp;
    const input: SavePlaybackResumeInput = {
      aniListId: options.mediaId,
      episode: options.episode,
      positionSeconds: Math.max(0, latestProgress.currentTime),
      durationSeconds: latestProgress.duration,
    };
    try {
      void Promise.resolve(options.saveResume(input)).then(
        () => updateSnapshot({ persistenceError: undefined }),
        (reason: unknown) =>
          updateSnapshot({
            persistenceError:
              reason instanceof Error ? reason.message : "Unable to save local progress.",
          }),
      );
    } catch (reason) {
      updateSnapshot({
        persistenceError:
          reason instanceof Error ? reason.message : "Unable to save local progress.",
      });
    }
  };

  const markWatched = (): void => {
    if (completed || completing) return;
    completionRequested = true;
    completing = true;
    void (async () => {
      try {
        await options.onWatched(options.episode);
        await options.clearResume(options.mediaId);
        completed = true;
        latestProgress = undefined;
        updateSnapshot({ persistenceError: undefined });
      } catch (reason) {
        updateSnapshot({
          persistenceError:
            reason instanceof Error ? reason.message : "Unable to save local completion.",
        });
      } finally {
        completing = false;
      }
    })();
  };

  return {
    activate() {
      if (!disposed) return;
      disposed = false;
      timer = startLoadTimer();
    },
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    markLoaded() {
      if (!disposed) updateSnapshot({ loaded: true });
    },

    markWatched,

    setPlayerCallbacks(next) {
      callbacks = next;
    },

    retryPersistence() {
      if (completionRequested) markWatched();
      else persistLatest(true);
    },

    handleMessage(data, origin, source, expectedSource) {
      if (
        disposed ||
        origin !== options.playerOrigin ||
        expectedSource === null ||
        source !== expectedSource
      ) {
        return;
      }

      const message = parseAnimePlayerMessage(data, options.eventSource);
      if (!message) return;
      // A player that names what it plays must be playing this title and episode.
      if (
        message.kind !== "error" &&
        ((message.aniListId !== undefined && message.aniListId !== options.mediaId) ||
          (message.episode !== undefined && message.episode !== options.episode))
      )
        return;
      if (message.kind === "navigate") {
        callbacks.onNavigate?.(message.direction);
        return;
      }
      if (message.kind === "audio") {
        // Before playback starts this is the player settling (e.g. no dub, so sub); after, the
        // viewer picked it in the player's menu.
        if (
          message.language &&
          snapshot.hasProgressed &&
          snapshot.language &&
          message.language !== snapshot.language
        )
          callbacks.onAudioChosen?.(message.language);
        if (message.language) updateSnapshot({ language: message.language });
        return;
      }
      if (message.kind !== "error" && message.language)
        updateSnapshot({ language: message.language });

      if (message.kind === "progress") {
        const seconds = Math.floor(message.currentTime);
        updateSnapshot({
          loaded: true,
          hasProgressed: true,
          loadTimedOut: false,
          hasError: false,
          errorMessage: undefined,
          // Ticks arrive about four times a second; listeners hear of whole seconds only.
          position:
            snapshot.position?.seconds === seconds
              ? snapshot.position
              : { seconds, duration: message.duration },
        });
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
        updateSnapshot({
          loaded: true,
          ended: true,
          loadTimedOut: false,
          hasError: false,
          errorMessage: undefined,
        });
        markWatched();
        return;
      }

      updateSnapshot({
        hasError: true,
        errorMessage: friendlyPlaybackError(message.message),
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
