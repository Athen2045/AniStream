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
/** Within this many seconds of the end, the episode has played out (players stop just short). */
const FINISHED_SECONDS = 2;
/** Seconds the reported position must advance before playback counts as started. */
const START_ADVANCE_SECONDS = 0.5;

export interface MorePlaybackSessionSnapshot {
  loaded: boolean;
  hasError: boolean;
  /** Watched: past 90 % (the credits), saved as completed. */
  ended: boolean;
  /**
   * Played to the very end (the player said so, or the position reached the last seconds). Only
   * then does AniStream's Next episode prompt and its countdown appear; during the credits the
   * player's own Next button is left alone (user report 2026-10-28).
   */
  finished: boolean;
  errorMessage?: string;
  persistenceError?: string;
  /** Last playing state the player reported; undefined until it reports one. */
  playing?: boolean;
  /**
   * The episode playing now. It differs from the one opened once the player moves on by itself
   * (its own next-episode button or autoplay); progress is then saved under the new episode.
   */
  season?: number;
  episode?: number;
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
    finished: false,
    started: false,
    season: options.season,
    episode: options.episode,
  };
  let latest: { currentTime: number; duration: number } | undefined;
  let firstPosition: number | undefined;
  let lastSavedAt = 0;
  let disposed = false;
  const publish = (changes: Partial<MorePlaybackSessionSnapshot>): void => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach((listener) => listener());
  };
  const write = (positionSeconds: number, durationSeconds: number): void => {
    const input: SaveMorePlaybackResumeInput = {
      tmdbId: options.tmdbId,
      type: options.type,
      season: snapshot.season,
      episode: snapshot.episode,
      positionSeconds,
      durationSeconds,
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
  const save = (force: boolean): void => {
    if (!latest || snapshot.ended) return;
    const now = Date.now();
    if (!force && now - lastSavedAt < SAVE_INTERVAL_MS) return;
    lastSavedAt = now;
    write(latest.currentTime, latest.duration);
  };
  /**
   * Saved as watched to the end (kept, not removed): Continue Watching then offers the next
   * episode, and a finished movie leaves it (`more-library.ts`).
   */
  const complete = (): void => {
    if (snapshot.ended) return;
    publish({ ended: true, loaded: true });
    if (latest) write(latest.duration, latest.duration);
  };
  /** The player moved to another episode itself: keep the last one's progress, follow it. */
  const follow = (season: number, episode: number): void => {
    save(true);
    latest = undefined;
    firstPosition = undefined;
    lastSavedAt = 0;
    publish({ ended: false, finished: false, season, episode });
  };
  const track = (event: Extract<MorePlayerMessage, { kind: "progress" | "ended" }>): void => {
    if (event.kind === "ended") {
      complete();
      if (!snapshot.finished) publish({ finished: true });
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
      if (!snapshot.finished && event.duration - event.currentTime <= FINISHED_SECONDS)
        publish({ finished: true });
    }
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
        event.mediaType !== (options.type === "MOVIE" ? "movie" : "tv")
      ) {
        return;
      } else {
        if (
          event.season !== undefined &&
          event.episode !== undefined &&
          (event.season !== snapshot.season || event.episode !== snapshot.episode)
        ) {
          // Only a progress event switches episodes: an "ended" for another episode is stale.
          if (event.kind === "ended") return;
          follow(event.season, event.episode);
        }
        track(event);
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
