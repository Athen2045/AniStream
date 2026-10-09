import type { MoreMediaType, SaveMorePlaybackResumeInput } from "../../shared/contracts";
import { parseMorePlayerMessage, type MorePlayerMessage } from "../../shared/more-player-messages";
import { friendlyMorePlayerError, friendlyMorePlayerStatus } from "./remote-error";

const SAVE_INTERVAL_MS = 10_000;

/**
 * Accepts a postMessage only from the exact configured player origin (taken from the URL main
 * built) and the active iframe window, then validates its payload.
 */
export function readMorePlayerMessage(input: {
  data: unknown;
  origin: string;
  source: MessageEventSource | null;
  playerOrigin: string;
  frameWindow: MessageEventSource | null;
}): MorePlayerMessage | undefined {
  if (
    input.origin !== input.playerOrigin ||
    !input.frameWindow ||
    input.source !== input.frameWindow
  )
    return undefined;
  return parseMorePlayerMessage(input.data);
}
const COMPLETE_PERCENT = 90;
/** Seconds the reported position must advance before playback counts as started. */
const START_ADVANCE_SECONDS = 0.5;

export interface MorePlaybackSessionSnapshot {
  loaded: boolean;
  hasError: boolean;
  ended: boolean;
  errorMessage?: string;
  persistenceError?: string;
  /** Last playing state the player reported; undefined until it reports one. */
  playing?: boolean;
  /**
   * True once the reported position has advanced, i.e. the player really plays this title. A
   * loaded page alone proves nothing: players show "no source" pages without reporting an error.
   */
  started: boolean;
}

export function createMorePlaybackSession(options: {
  tmdbId: number;
  type: MoreMediaType;
  attempt: number;
  season?: number;
  episode?: number;
  saveResume: (input: SaveMorePlaybackResumeInput) => Promise<void>;
  clearResume: () => Promise<void>;
}): {
  activate(): void;
  getSnapshot(): MorePlaybackSessionSnapshot;
  subscribe(listener: () => void): () => void;
  markLoaded(): void;
  /** Receives player messages already accepted by `readMorePlayerMessage`. */
  handleEvent(event: MorePlayerMessage): void;
  dispose(): void;
  retryPersistence(): void;
} {
  const listeners = new Set<() => void>();
  let snapshot: MorePlaybackSessionSnapshot = {
    loaded: false,
    hasError: false,
    ended: false,
    started: false,
  };
  let latest: { currentTime: number; duration: number } | undefined;
  let firstPosition: number | undefined;
  let lastSavedAt = 0;
  let disposed = false;
  const publish = (changes: Partial<MorePlaybackSessionSnapshot>): void => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  };
  const save = (force: boolean): void => {
    if (!latest || snapshot.ended) return;
    const now = Date.now();
    if (!force && now - lastSavedAt < SAVE_INTERVAL_MS) return;
    lastSavedAt = now;
    const input: SaveMorePlaybackResumeInput = {
      tmdbId: options.tmdbId,
      type: options.type,
      season: options.season,
      episode: options.episode,
      positionSeconds: latest.currentTime,
      durationSeconds: latest.duration,
    };
    void options.saveResume(input).then(
      () => publish({ persistenceError: undefined }),
      (reason: unknown) =>
        publish({
          persistenceError:
            reason instanceof Error ? reason.message : "Unable to save local progress.",
        }),
    );
  };
  const complete = (): void => {
    if (snapshot.ended) return;
    publish({ ended: true, loaded: true });
    void options.clearResume().catch((reason: unknown) =>
      publish({
        persistenceError:
          reason instanceof Error ? reason.message : "Unable to clear local progress.",
      }),
    );
  };
  return {
    activate() {
      disposed = false;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markLoaded() {
      publish({ loaded: true });
    },
    handleEvent(event) {
      if (disposed) return;
      if (event.kind === "error") {
        publish({
          hasError: true,
          errorMessage: friendlyMorePlayerError(
            event.message ?? "The player reported a playback error.",
          ),
        });
      } else if (event.kind === "status") {
        const errorMessage = friendlyMorePlayerStatus(event.httpStatus);
        if (errorMessage) publish({ hasError: true, errorMessage });
      } else if (
        event.id !== String(options.tmdbId) ||
        event.mediaType !== (options.type === "MOVIE" ? "movie" : "tv") ||
        // After autoNext the same player reports the next episode; never save it under this one.
        (event.episode !== undefined &&
          (event.season !== options.season || event.episode !== options.episode))
      ) {
        return;
      } else if (event.kind === "ended") {
        complete();
      } else {
        latest = { currentTime: event.currentTime, duration: event.duration };
        firstPosition ??= event.currentTime;
        const started =
          snapshot.started || event.currentTime >= firstPosition + START_ADVANCE_SECONDS;
        publish({
          loaded: true,
          started,
          hasError: false,
          errorMessage: undefined,
          ...(event.playing === undefined ? {} : { playing: event.playing }),
        });
        if ((event.currentTime / event.duration) * 100 >= COMPLETE_PERCENT) complete();
        else save(false);
      }
    },
    retryPersistence() {
      save(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      save(true);
      listeners.clear();
    },
  };
}
