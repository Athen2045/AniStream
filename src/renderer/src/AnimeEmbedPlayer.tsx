import { takePlayerFocus } from "./player-focus";
import { PlayerStarting } from "./PlayerStarting";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  AniListCatalogMedia,
  AnimePlaybackCandidate,
  AnimeProviderEpisode,
  AnimeSkipSegment,
} from "../../shared/contracts";
import { NextUpButton } from "./player/NextUpButton";
import { createAnimePlaybackSession } from "./anime-playback-session";
import { saveAnimeActivity } from "./local-activity";
import { AutoplayNext, useNextUp } from "./AutoplayNext";

export function AnimeEmbedPlayer({
  mediaId,
  media,
  title,
  episode,
  source,
  nextEpisode,
  onNext,
  onWatched,
  onRetry,
  onUseBackup,
  onSwitchPlayer,
}: {
  mediaId: number;
  media: AniListCatalogMedia;
  title: string;
  episode: AnimeProviderEpisode;
  source: AnimePlaybackCandidate;
  nextEpisode?: AnimeProviderEpisode;
  onNext: (episode: AnimeProviderEpisode) => void;
  onWatched: (episode: number) => Promise<void>;
  onRetry: () => void;
  /** Hands the episode to the backup (own) player. */
  onUseBackup: () => void;
  /** The next player in order, when there is more than one ("Switch player"). */
  onSwitchPlayer?: () => void;
}): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const session = useMemo(
    () =>
      createAnimePlaybackSession({
        mediaId,
        playerOrigin: new URL(source.url).origin,
        episode: episode.number,
        eventSource: source.eventSource,
        saveResume: (input) => saveAnimeActivity(media, input),
        // Completion clears only this episode's checkpoint atomically in the main journal.
        clearResume: () => undefined,
        onWatched,
      }),
    [episode.number, media, mediaId, onWatched, source.eventSource, source.url],
  );
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  // The indexed player's error hands the episode to the backup player by itself. A player that
  // reports its own events tries its own servers first, so its errors only show the notice, from
  // which the viewer can switch (user decision 2026-10-31: switching is manual).
  const autoBackup = source.eventSource === undefined;
  useEffect(() => {
    if (autoBackup && sessionState.hasError) onUseBackup();
  }, [autoBackup, onUseBackup, sessionState.hasError]);
  // Asked for the dub, the player said it plays the sub (it has no dub for this episode).
  const dubMissing = source.language === "dub" && sessionState.language === "sub";
  // The next episode wins; at the end of what is available, the next Up Next title plays.
  const nextUp = useNextUp(
    nextEpisode
      ? {
          heading: "Next episode",
          title: `E${nextEpisode.number} · ${nextEpisode.title ?? `Episode ${nextEpisode.number}`}`,
          play: () => onNext(nextEpisode),
        }
      : undefined,
    [`anime:${mediaId}`, `anime:${mediaId}:e${episode.number}`],
  );

  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  // The episode's ending (AniSkip, by MAL id, once the player reports its length): while it
  // plays, a "Next episode" pill in the Skip style plays the next one, as in the own player.
  const [endings, setEndings] = useState<AnimeSkipSegment[]>([]);
  const length =
    sessionState.position === undefined ? undefined : Math.round(sessionState.position.duration);
  const hasNext = nextEpisode !== undefined;
  useEffect(() => {
    if (!length || !media.malId || !hasNext) return;
    let active = true;
    void window.anistream
      .getAnimeSkipTimes({
        aniListId: media.id,
        malId: media.malId,
        episode: episode.number,
        durationSeconds: length,
      })
      .then((segments) => {
        if (active) setEndings(segments.filter((segment) => segment.kind === "ending"));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [episode.number, hasNext, length, media.id, media.malId]);
  const seconds = sessionState.position?.seconds;
  const inEnding =
    seconds !== undefined &&
    endings.some((segment) => seconds >= segment.start && seconds < segment.end - 1);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      session.handleMessage(
        event.data,
        event.origin,
        event.source,
        iframeRef.current?.contentWindow ?? null,
      );
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [session]);

  return (
    <div className="anistream-player anime-embed-player">
      <iframe
        ref={iframeRef}
        className="anime-embed-frame"
        src={source.url}
        aria-label={`${title} episode ${episode.number} · ${source.label}`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => {
          session.markLoaded();
          takePlayerFocus(iframeRef.current);
        }}
      />

      {sessionState.loadTimedOut || sessionState.hasError ? (
        <div className="anime-embed-notice" role={sessionState.hasError ? "alert" : "status"}>
          <strong>{sessionState.errorMessage ?? "No playback progress received yet."}</strong>
          <p>
            {sessionState.hasError && autoBackup
              ? "The main player reported an error. Switching to the backup player."
              : onSwitchPlayer
                ? "Use Play inside the video. If it still does not start, retry or switch to another player."
                : "Use Play inside the video. If it still does not start, retry or use the backup player."}
          </p>
          <span className="anime-embed-notice-actions">
            <button type="button" onClick={onRetry}>
              Retry player
            </button>
            {onSwitchPlayer ? (
              <button type="button" onClick={onSwitchPlayer}>
                Switch player
              </button>
            ) : (
              <button type="button" onClick={onUseBackup}>
                Use backup player
              </button>
            )}
          </span>
        </div>
      ) : !sessionState.hasError && !sessionState.ended && !sessionState.loaded ? (
        <div className="anime-embed-loading">
          <PlayerStarting
            title={`Starting ${title} · E${episode.number}`}
            detail={`Loading the player · ${source.label}`}
            backdropUrl={media.bannerUrl ?? media.coverUrl}
          />
        </div>
      ) : null}

      {dubMissing ? (
        <div className="anime-embed-language" role="status">
          No English dub for this episode on this player, so it plays with subtitles.
          {onSwitchPlayer ? " Switch player to look for a dub elsewhere." : ""}
        </div>
      ) : null}

      {sessionState.persistenceError ? (
        <div className="watch-player-error" role="alert">
          <p>Progress could not be saved: {sessionState.persistenceError}</p>
          <button type="button" onClick={() => session.retryPersistence()}>
            Retry saving
          </button>
        </div>
      ) : null}

      {sessionState.ended && nextUp ? (
        <AutoplayNext key={`${mediaId}:${episode.number}`} next={nextUp} />
      ) : inEnding && nextEpisode ? (
        // Above the player's own Skip Outro button, which sits where the pill usually does.
        <div className="anime-embed-ending">
          <NextUpButton
            heading="Next episode"
            title={`E${nextEpisode.number} · ${nextEpisode.title ?? `Episode ${nextEpisode.number}`}`}
            total={1}
            onPlay={() => {
              session.markWatched();
              onNext(nextEpisode);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
