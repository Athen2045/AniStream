import { Container } from "@videojs/react";
import { Video, VideoPlayer } from "@videojs/react/video";
import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AniListCatalogMedia,
  AnimeDirectPlayback,
  AnimeDirectSubtitle,
  AnimeProviderEpisode,
  AnimeSkipSegment,
} from "../../../shared/contracts";
import { getAppPreferences } from "../app-preferences";
import { saveAnimeActivity } from "../local-activity";
import { PlayerStarting } from "../PlayerStarting";
import { NextUpButton } from "./NextUpButton";
import { takePlayerFocus } from "../player-focus";
import { PlayerControls, returnFocusToPlayer, type PlayerOption } from "./PlayerControls";
import {
  baseLanguage,
  readAudioLanguage,
  readAutoplay,
  readBandwidthEstimate,
  readSubtitleChoice,
  readVideoVolume,
  writeAudioLanguage,
  writeAutoplay,
  writeBandwidthEstimate,
  writeSubtitleChoice,
  writeVideoVolume,
} from "./player-prefs";
import { useStableVolume } from "./stable-volume";
import { SeekThumbnails } from "./seek-thumbnails";

/** Save at most this often while playing; pause and the end always save. */
const SAVE_INTERVAL_MS = 10_000;
/** Watched once this share of the episode has played. */
const WATCHED_SHARE = 0.9;
/** Seconds the "Up next" note counts down before the next episode. */
const AUTOPLAY_SECONDS = 5;
const RESUME_NOTE_MS = 6_000;

/**
 * AniStream's own anime player (user decision 2026-10-18), ported from the user's own player:
 * Video.js parts for the controls, hls.js for the stream (Chromium has no native HLS on Windows),
 * which the main process proxies. Subtitles load as WebVTT only when chosen; audio tracks (dubs)
 * come from the stream itself.
 */
export function OwnAnimePlayer({
  media,
  title,
  episode,
  previousEpisode,
  nextEpisode,
  resumeAt,
  onNext,
  onPrevious,
  onWatched,
  onUseMainPlayer,
}: {
  media: AniListCatalogMedia;
  title: string;
  episode: AnimeProviderEpisode;
  previousEpisode?: AnimeProviderEpisode;
  nextEpisode?: AnimeProviderEpisode;
  /** Saved position for this episode, in seconds. */
  resumeAt?: number;
  onNext: (episode: AnimeProviderEpisode) => void;
  onPrevious?: (episode: AnimeProviderEpisode) => void;
  onWatched: (episode: number) => Promise<void>;
  /** Switch back to the embedded player, when it has a source for this episode. */
  onUseMainPlayer?: () => void;
}): React.JSX.Element {
  const [playback, setPlayback] = useState<AnimeDirectPlayback>();
  const [attempt, setAttempt] = useState(0);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const stable = useStableVolume(video);
  // Keyed by stream URL: a new stream starts without the previous one's failure.
  const [failure, setFailure] = useState<{ stream: string; message: string }>();
  const [audioTracks, setAudioTracks] = useState<PlayerOption[]>([]);
  const [audioCurrent, setAudioCurrent] = useState<string | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const [subtitlePick, setSubtitlePick] = useState<{ stream: string; id: string | null }>();
  const [subtitleData, setSubtitleData] = useState<{ id: string; data: AnimeDirectSubtitle }>();
  // A track the ASS renderer could not show falls back to text-only WebVTT.
  const [assFailedFor, setAssFailedFor] = useState<string>();
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const [upNext, setUpNext] = useState<number | null>(null);
  // The next-episode button after the end, also once its countdown is cancelled or autoplay is off.
  const [nextOffered, setNextOffered] = useState(false);
  const lastSaveRef = useRef(0);
  const watchedRef = useRef(false);
  // Opening/ending for the Skip button (AniSkip, by MAL id), and where playback is inside one.
  const [skipSegments, setSkipSegments] = useState<AnimeSkipSegment[]>([]);
  const [skipNow, setSkipNow] = useState<{ index: number; progress: number } | null>(null);

  useEffect(() => {
    if (video) takePlayerFocus(containerRef.current);
  }, [video]);

  // Resolve the episode's stream (match, then the episode page) in the main process.
  useEffect(() => {
    let active = true;
    window.anistream
      .getAnimeDirectPlayback({ aniListId: media.id, episode: episode.number })
      .then((result) => {
        if (active) setPlayback(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setPlayback({
            status: "unavailable",
            message: reason instanceof Error ? reason.message : "The backup player failed.",
          });
      });
    return () => {
      active = false;
    };
  }, [attempt, episode.number, media.id]);

  const ready = playback?.status === "ready" ? playback : undefined;
  // Seek-bar previews from a low-quality copy of the same stream; started on first hover.
  const thumbnails = useMemo(() => (ready ? new SeekThumbnails(ready.streamUrl) : null), [ready]);
  useEffect(() => () => thumbnails?.dispose(), [thumbnails]);
  const subtitleOptions = useMemo<PlayerOption[]>(() => {
    const seen = new Map<string, number>();
    return (ready?.subtitles ?? []).map((track) => {
      const name = languageName(track.language, track.label);
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      return { id: track.id, label: count === 1 ? name : `${name} (${count})` };
    });
  }, [ready]);

  const failed = failure && failure.stream === ready?.streamUrl ? failure.message : undefined;
  // The viewer's pick for this stream, else the remembered subtitle language, else off.
  const defaultSubtitle = useMemo(() => {
    if (!ready) return null;
    const choice = readSubtitleChoice();
    const wanted = baseLanguage(choice.language);
    const same = ready.subtitles.filter((track) => baseLanguage(track.language) === wanted);
    return choice.enabled ? ((same.find((track) => track.default) ?? same[0])?.id ?? null) : null;
  }, [ready]);
  const subtitleId =
    subtitlePick && subtitlePick.stream === ready?.streamUrl ? subtitlePick.id : defaultSubtitle;

  // Fetch the chosen track: ASS goes to the ASS renderer, anything else to a <track>.
  useEffect(() => {
    if (!subtitleId) return;
    let active = true;
    window.anistream
      .getAnimeDirectSubtitle(subtitleId)
      .then((data) => {
        if (active) setSubtitleData({ id: subtitleId, data });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [subtitleId]);
  const loadedSubtitle = subtitleData?.id === subtitleId ? subtitleData : undefined;
  const assSubtitle =
    loadedSubtitle?.data.format === "ass" && assFailedFor !== loadedSubtitle.id
      ? loadedSubtitle
      : undefined;

  // ASS/SSA with JASSUB (libass in WebAssembly): styling, positioning and signs as authored.
  // Fonts: the episode's own plus this device's (never fetched from the internet).
  useEffect(() => {
    if (!video || !assSubtitle) return;
    let instance: { destroy: () => Promise<void> } | undefined;
    let cancelled = false;
    const fallBack = (reason: unknown): void => {
      console.warn("ASS subtitles fell back to text-only:", reason);
      setAssFailedFor(assSubtitle.id);
    };
    void import("jassub")
      .then(({ default: JASSUB }) => {
        if (cancelled) return;
        const renderer = new JASSUB({
          video,
          subContent: assSubtitle.data.text,
          fonts: ready?.fonts ?? [],
          queryFonts: "local",
        });
        instance = renderer;
        renderer.ready.catch(fallBack);
      })
      .catch(fallBack);
    return () => {
      cancelled = true;
      void instance?.destroy().catch(() => undefined);
    };
  }, [assSubtitle, ready?.fonts, video]);

  // Text-only WebVTT: non-ASS tracks, or ASS when the renderer cannot start.
  const vttUrl = useMemo(
    () =>
      loadedSubtitle && !assSubtitle
        ? URL.createObjectURL(new Blob([loadedSubtitle.data.vtt], { type: "text/vtt" }))
        : undefined,
    [assSubtitle, loadedSubtitle],
  );
  useEffect(
    () => () => {
      if (vttUrl) URL.revokeObjectURL(vttUrl);
    },
    [vttUrl],
  );

  // Show the loaded track (an added <track> starts hidden).
  useEffect(() => {
    const list = video?.textTracks;
    if (!list) return;
    showTracks(list, Boolean(vttUrl));
  }, [vttUrl, video]);

  const chooseSubtitle = (id: string | null): void => {
    if (ready) setSubtitlePick({ stream: ready.streamUrl, id });
    const track = ready?.subtitles.find((item) => item.id === id);
    writeSubtitleChoice(track ? { enabled: true, language: track.language } : { enabled: false });
  };

  // hls.js on the Video.js element; audio tracks follow the stream.
  useEffect(() => {
    if (!video || !ready) return;
    const stream = ready.streamUrl;
    if (!Hls.isSupported()) {
      queueMicrotask(() =>
        setFailure({ stream, message: "This device cannot play the backup stream." }),
      );
      return;
    }
    const bandwidth = readBandwidthEstimate();
    const hls = new Hls({
      enableWorker: true,
      ...(bandwidth ? { abrEwmaDefaultEstimate: bandwidth } : {}),
    });
    hlsRef.current = hls;
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
      const options = data.audioTracks.map((track, index) => ({
        id: String(index),
        label: track.name || languageName(track.lang ?? "", `Track ${index + 1}`),
      }));
      setAudioTracks(options);
      const saved = baseLanguage(readAudioLanguage());
      const preferred = getAppPreferences().audio === "dub" ? "en" : "ja";
      const index = [saved, preferred]
        .filter(Boolean)
        .map((language) =>
          data.audioTracks.findIndex((track) => baseLanguage(track.lang) === language),
        )
        .find((found) => found >= 0);
      if (index !== undefined && index !== hls.audioTrack) hls.audioTrack = index;
      setAudioCurrent(String(index ?? hls.audioTrack));
    });
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => setAudioCurrent(String(data.id)));
    // Cut off by a lost connection: say so and continue from here once it is back, instead of
    // retrying in a loop against no network.
    let resumeOnline: (() => void) | undefined;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && navigator.onLine === false) {
        if (resumeOnline) return;
        setWaitingForConnection(true);
        resumeOnline = () => {
          resumeOnline = undefined;
          setWaitingForConnection(false);
          window.setTimeout(() => hls.startLoad(), 1_000);
        };
        window.addEventListener("online", resumeOnline, { once: true });
      } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else setFailure({ stream, message: "The backup stream stopped. Try again." });
    });
    hls.loadSource(ready.streamUrl);
    hls.attachMedia(video);
    return () => {
      if (resumeOnline) window.removeEventListener("online", resumeOnline);
      writeBandwidthEstimate(hls.bandwidthEstimate);
      hls.destroy();
      hlsRef.current = null;
    };
  }, [ready, video]);

  const chooseAudio = (id: string): void => {
    const hls = hlsRef.current;
    const index = Number(id);
    if (!hls || !Number.isInteger(index)) return;
    hls.audioTrack = index;
    const language = hls.audioTracks[index]?.lang;
    if (language) writeAudioLanguage(language);
  };

  // One volume across episodes and sessions.
  useEffect(() => {
    if (!video) return;
    const saved = readVideoVolume();
    if (saved) applyVolume(video, saved);
    const remember = (): void => writeVideoVolume(video.volume, video.muted);
    video.addEventListener("volumechange", remember);
    return () => video.removeEventListener("volumechange", remember);
  }, [video]);

  const save = useCallback((): void => {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    void saveAnimeActivity(media, {
      aniListId: media.id,
      episode: episode.number,
      positionSeconds: Math.max(0, video.currentTime),
      durationSeconds: video.duration,
    }).catch(() => undefined);
  }, [episode.number, media, video]);

  const markWatched = useCallback((): void => {
    if (watchedRef.current) return;
    watchedRef.current = true;
    void onWatched(episode.number).catch(() => {
      watchedRef.current = false;
    });
  }, [episode.number, onWatched]);

  const onTimeUpdate = (): void => {
    if (!video) return;
    const at = skipSegments.findIndex(
      (segment) => video.currentTime >= segment.start && video.currentTime < segment.end - 1,
    );
    if (at < 0) {
      if (skipNow) setSkipNow(null);
    } else {
      const segment = skipSegments[at];
      const progress = (video.currentTime - segment.start) / (segment.end - segment.start);
      // About one update a second is enough for the fill and the seconds left.
      if (!skipNow || skipNow.index !== at || Math.abs(skipNow.progress - progress) >= 0.01)
        setSkipNow({ index: at, progress });
    }
    if (video.duration > 0 && video.currentTime / video.duration >= WATCHED_SHARE) markWatched();
    const now = Date.now();
    if (now - lastSaveRef.current < SAVE_INTERVAL_MS) return;
    lastSaveRef.current = now;
    save();
  };

  const onLoadedMetadata = (): void => {
    if (!video) return;
    const duration = video.duration;
    if (media.malId && Number.isFinite(duration) && duration > 0)
      void window.anistream
        .getAnimeSkipTimes({
          aniListId: media.id,
          malId: media.malId,
          episode: episode.number,
          durationSeconds: duration,
        })
        .then(setSkipSegments)
        .catch(() => undefined);
    if (!resumeAt || resumeAt < 10 || resumeAt > duration - 15) return;
    seekTo(video, resumeAt);
    setResumedAt(resumeAt);
  };

  const onEnded = (): void => {
    markWatched();
    if (!nextEpisode) return;
    setNextOffered(true);
    if (autoplay) setUpNext(AUTOPLAY_SECONDS);
  };

  useEffect(() => {
    if (upNext === null) return;
    if (upNext <= 0) {
      // The player remounts for the next episode, which resets the countdown.
      if (nextEpisode) onNext(nextEpisode);
      return;
    }
    const timer = window.setTimeout(
      () => setUpNext((left) => (left === null ? null : left - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [nextEpisode, onNext, upNext]);

  useEffect(() => {
    if (resumedAt === null) return;
    const timer = window.setTimeout(() => setResumedAt(null), RESUME_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [resumedAt]);

  // Leaving the player saves the position.
  useEffect(() => () => save(), [save]);

  // A stream far off the episode's expected runtime is probably a mislabelled video.
  const [runtimeDismissed, setRuntimeDismissed] = useState(false);
  const runtimeWarning = ready?.runtime?.mismatch && !runtimeDismissed ? ready.runtime : undefined;

  // The end-of-episode prompt sits where Skip opening does, visible while the controls hide.
  const nextUp =
    nextOffered && nextEpisode ? (
      <NextUpButton
        heading="Next episode"
        title={episodeLabel(nextEpisode)}
        remaining={upNext ?? undefined}
        total={AUTOPLAY_SECONDS}
        onPlay={() => onNext(nextEpisode)}
        onCancel={() => setUpNext(null)}
      />
    ) : null;
  const note = waitingForConnection ? (
    <span role="status">You’re offline. The episode continues when you’re back online.</span>
  ) : resumedAt !== null ? (
    <span role="status">
      Resumed at {clock(resumedAt)}
      <button
        type="button"
        onClick={() => {
          seekTo(video, 0);
          setResumedAt(null);
        }}
      >
        Start over
      </button>
    </span>
  ) : null;

  if (!playback) {
    return (
      <div className="anistream-player own-player">
        <PlayerStarting
          title={`Starting ${title} · E${episode.number}`}
          detail="Loading the backup player"
          backdropUrl={media.bannerUrl ?? media.coverUrl}
        />
      </div>
    );
  }

  if (playback.status === "unavailable" || failed) {
    return (
      <div className="anistream-player own-player">
        <div className="player-unavailable" role="alert">
          <h3>Backup player unavailable</h3>
          <p>{failed ?? (playback.status === "unavailable" ? playback.message : "")}</p>
          <button
            type="button"
            onClick={() => {
              setFailure(undefined);
              setPlayback(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anistream-player own-player">
      <VideoPlayer>
        <Container ref={containerRef} className="vplayer" onPointerUpCapture={returnFocusToPlayer}>
          <Video
            ref={setVideo}
            // Stable volume (Web Audio) needs CORS-clean media; the stream proxy allows it.
            crossOrigin="anonymous"
            autoPlay
            playsInline
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPause={save}
            onEnded={onEnded}
          >
            {vttUrl ? (
              <track
                key={vttUrl}
                kind="subtitles"
                src={vttUrl}
                label={subtitleOptions.find((option) => option.id === subtitleId)?.label}
                default
              />
            ) : null}
          </Video>
          {runtimeWarning ? (
            <div className="vplayer-warning" role="alert">
              <div>
                <strong>This may be the wrong video</strong>
                <p>
                  It runs {clock(runtimeWarning.actualSeconds)}, but episode {episode.number}{" "}
                  {runtimeWarning.basis === "episode" ? "should run" : "episodes usually run"} about{" "}
                  {Math.round(runtimeWarning.expectedSeconds / 60)} min. The backup source may have
                  linked a different video.
                </p>
              </div>
              <div className="vplayer-warning-actions">
                {onUseMainPlayer ? (
                  <button type="button" onClick={onUseMainPlayer}>
                    Use main player
                  </button>
                ) : null}
                <button type="button" onClick={() => setRuntimeDismissed(true)}>
                  Keep watching
                </button>
              </div>
            </div>
          ) : null}
          <PlayerControls
            video={video}
            heading={{
              show: title,
              episode: media.format === "MOVIE" ? "Movie" : `Episode ${episode.number}`,
              title: episode.title?.trim() || undefined,
            }}
            navigation={{
              previous:
                previousEpisode && onPrevious
                  ? { title: episodeLabel(previousEpisode), go: () => onPrevious(previousEpisode) }
                  : null,
            }}
            skip={
              skipNow && skipSegments[skipNow.index]
                ? {
                    segment: skipSegments[skipNow.index],
                    progress: skipNow.progress,
                    next: nextEpisode ? episodeLabel(nextEpisode) : undefined,
                    go: () => {
                      const segment = skipSegments[skipNow.index];
                      if (!video || !segment) return;
                      // Skipping an ending goes straight to the next episode, when there is one.
                      if (segment.kind === "ending" && nextEpisode) {
                        markWatched();
                        onNext(nextEpisode);
                        return;
                      }
                      // Past the last half second the episode simply ends (and Up next starts).
                      seekTo(video, Math.min(segment.end, video.duration - 0.5));
                      setSkipNow(null);
                    },
                  }
                : null
            }
            thumbnails={thumbnails}
            note={note}
            stable={stable}
            autoplay={{
              on: autoplay,
              toggle: () =>
                setAutoplay((on) => {
                  writeAutoplay(!on);
                  return !on;
                }),
            }}
            subtitles={{ options: subtitleOptions, current: subtitleId, choose: chooseSubtitle }}
            audio={{ options: audioTracks, current: audioCurrent, choose: chooseAudio }}
          />
          {nextUp}
        </Container>
      </VideoPlayer>
    </div>
  );
}

function episodeLabel(episode: AnimeProviderEpisode): string {
  return `E${episode.number} · ${episode.title ?? `Episode ${episode.number}`}`;
}

/** "English", "Português (Brasil)"; the source's own label when the tag is unknown. */
function languageName(tag: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames(undefined, { type: "language" }).of(tag);
    return name && name.toLowerCase() !== tag.toLowerCase() ? name : fallback;
  } catch {
    return fallback;
  }
}

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/* The <video> element and its tracks belong to the browser, not React: change them here. */
function applyVolume(element: HTMLVideoElement, saved: { volume: number; muted: boolean }): void {
  element.volume = saved.volume;
  element.muted = saved.muted;
}

function seekTo(element: HTMLVideoElement | null, seconds: number): void {
  if (element) element.currentTime = seconds;
}

function showTracks(list: TextTrackList, show: boolean): void {
  for (let index = 0; index < list.length; index += 1)
    list[index].mode = show ? "showing" : "disabled";
}
