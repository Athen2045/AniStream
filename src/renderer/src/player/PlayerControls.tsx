import {
  Controls,
  FullscreenButton,
  Gesture,
  Hotkey,
  MuteButton,
  PlayButton,
  SeekButton,
  Time,
  TimeSlider,
  VolumeSlider,
} from "@videojs/react";
import { useEffect, useRef, useState } from "react";
import type { AnimeSkipSegment } from "../../../shared/contracts";
import type { EnhanceMode } from "./anime4k-enhancer";
import { PlayerIcon } from "./PlayerIcon";
import { THUMB_HEIGHT, THUMB_WIDTH, type SeekThumbnails } from "./seek-thumbnails";

/**
 * The own player's controls (redesign 2026-10-18, from the user's reference): the title at the
 * top left, a full-width seek bar with frame previews, then Play · Previous · −10 · +10 · volume ·
 * time on the left and CC · settings · full screen on the right. A "Skip opening/ending" button
 * appears over the bar while one plays. Built from Video.js parts so it keeps one pixel size in
 * full screen. AniStream adds an Audio page (dubs live inside the stream) and lazy subtitles.
 */
export const SKIP_SECONDS = 10;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type PlayerOption = { id: string; label: string };

export type PlayerControlsProps = {
  video: HTMLVideoElement | null;
  /** Shown at the top left while the controls are: the show, then the episode. */
  heading?: { show: string; episode: string; title?: string };
  navigation?: {
    previous: { title: string; go: () => void } | null;
  };
  note?: React.ReactNode;
  stable: { enabled: boolean; toggle: () => void } | null;
  autoplay: { on: boolean; toggle: () => void } | null;
  subtitles: {
    options: PlayerOption[];
    current: string | null;
    choose: (id: string | null) => void;
  };
  audio: { options: PlayerOption[]; current: string | null; choose: (id: string) => void };
  /**
   * The opening or ending playing now, with how far through it is (0–1). During an ending,
   * `next` names the next episode: the button then plays it instead of skipping to the end.
   */
  skip?: { segment: AnimeSkipSegment; progress: number; next?: string; go: () => void } | null;
  thumbnails?: SeekThumbnails | null;
  /** Anime4K (absent without WebGPU); `detail` says what runs and how fast. */
  enhance?: { mode: EnhanceMode; choose: (mode: EnhanceMode) => void; detail?: string } | null;
};

type MenuPage = "main" | "subtitles" | "audio" | "speed" | "enhance";

const ENHANCE_LABELS: Record<EnhanceMode, string> = {
  off: "Off",
  light: "Light",
  strong: "Strong",
};

/**
 * For the player's `onPointerUpCapture`: a clicked button or slider keeps keyboard focus, and the
 * shortcuts skip a focused control (Space presses the button again, arrows move the slider), so
 * hand focus back to the player after a click. Checked a tick later, once the control has done
 * its own focusing (sliders focus their thumb on release, Settings focuses its menu). The menu
 * keeps its focus; keyboard users who Tab to a control are unaffected (issue 38).
 */
export function returnFocusToPlayer(event: React.PointerEvent<HTMLElement>): void {
  const player = event.currentTarget;
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || active === player || !player.contains(active)) return;
    if (!active.closest("button, [role=slider]") || active.closest(".vmenu")) return;
    player.focus({ preventScroll: true });
  });
}

function SkipIcon({ forward }: { forward?: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={forward ? "M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6" : "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x={forward ? 11.6 : 12.4}
        y="16.6"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="currentColor"
      >
        {SKIP_SECONDS}
      </text>
    </svg>
  );
}

function usePlaybackRate(video: HTMLVideoElement | null): number {
  const [rate, setRate] = useState(1);
  useEffect(() => {
    if (!video) return;
    const read = (): void => setRate(video.playbackRate || 1);
    read();
    video.addEventListener("ratechange", read);
    return () => video.removeEventListener("ratechange", read);
  }, [video]);
  return rate;
}

/** Playback speed is set on the element, which React does not own. */
function setElementRate(element: HTMLVideoElement | null, rate: number): void {
  if (element) element.playbackRate = rate;
}

const speedLabel = (rate: number): string => `${rate.toFixed(2)}×`;

export function PlayerControls({
  video,
  heading,
  navigation,
  note,
  stable,
  autoplay,
  subtitles,
  audio,
  skip,
  thumbnails,
  enhance,
}: PlayerControlsProps): React.JSX.Element {
  const [menu, setMenu] = useState<MenuPage | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const rate = usePlaybackRate(video);
  const hasSubtitles = subtitles.options.length > 0;
  const showing = subtitles.current;
  // The track CC turns back on: the last one shown this session, else the first.
  const [lastSubtitle, setLastSubtitle] = useState<string | null>(showing);
  if (showing && showing !== lastSubtitle) setLastSubtitle(showing);

  // Close on a press outside the menu, and on Esc (without closing the player).
  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !gearRef.current?.contains(target)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu((page) => (page === "main" ? null : "main"));
      if (menu === "main") gearRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  useEffect(() => {
    if (menu) menuRef.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  }, [menu]);

  const toggleCaptions = (): void =>
    subtitles.choose(showing ? null : (lastSubtitle ?? subtitles.options[0]?.id ?? null));
  const setRate = (value: number): void => {
    setElementRate(video, value);
    setMenu("main");
  };
  const onMenuKey = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const label = (options: PlayerOption[], id: string | null): string | undefined =>
    options.find((option) => option.id === id)?.label;

  return (
    <>
      <Hotkey keys="Space" action="togglePaused" />
      <Hotkey keys="k" action="togglePaused" />
      <Hotkey keys="m" action="toggleMuted" />
      <Hotkey keys="f" action="toggleFullscreen" />
      <Hotkey keys="ArrowLeft" action="seekStep" value={-SKIP_SECONDS} />
      <Hotkey keys="ArrowRight" action="seekStep" value={SKIP_SECONDS} />
      <Hotkey keys="j" action="seekStep" value={-SKIP_SECONDS} />
      <Hotkey keys="l" action="seekStep" value={SKIP_SECONDS} />
      <Hotkey keys="ArrowUp" action="volumeStep" />
      <Hotkey keys="ArrowDown" action="volumeStep" />
      <Hotkey keys="0-9" action="seekToPercent" />
      <Hotkey keys=">" action="speedUp" />
      <Hotkey keys="<" action="speedDown" />
      <Gesture type="tap" action="togglePaused" pointer="mouse" region="center" />
      <Gesture type="tap" action="toggleControls" pointer="touch" />
      <Gesture type="doubletap" action="seekStep" value={-SKIP_SECONDS} region="left" />
      <Gesture type="doubletap" action="toggleFullscreen" region="center" />
      <Gesture type="doubletap" action="seekStep" value={SKIP_SECONDS} region="right" />

      {/* Stays up while the controls hide: the opening is the moment people want to skip. */}
      {skip ? <SkipSegmentButton {...skip} /> : null}

      <Controls.Root visibility={menu ? "always" : "auto"}>
        <Controls.Backdrop className="vbar-shade" />
        <Controls.Content className="vbar-layer">
          {heading ? (
            <div className="vplayer-heading">
              <small>{heading.show}</small>
              <strong>
                {heading.episode}
                {heading.title ? <span>{heading.title}</span> : null}
              </strong>
            </div>
          ) : null}
          {note ? <div className="vbar-note">{note}</div> : null}
          <div className="vbar-stack">
            <SeekBar video={video} thumbnails={thumbnails} />
            <Controls.Group className="vbar" aria-label="Video controls">
              <PlayButton
                className="vbar-btn vbar-btn--main"
                render={(props, state) => (
                  <button {...props} title={state.paused ? "Play (Space)" : "Pause (Space)"}>
                    <PlayerIcon name={state.paused ? "play" : "pause"} />
                  </button>
                )}
              />
              {navigation ? (
                <button
                  type="button"
                  className="vbar-btn"
                  aria-label="Previous episode"
                  title={
                    navigation.previous
                      ? `Previous: ${navigation.previous.title}`
                      : "No previous episode"
                  }
                  disabled={!navigation.previous}
                  onClick={navigation.previous?.go}
                >
                  <PlayerIcon name="prev" />
                </button>
              ) : null}
              <SeekButton
                seconds={-SKIP_SECONDS}
                className="vbar-btn"
                aria-label={`Back ${SKIP_SECONDS} seconds`}
                title={`Back ${SKIP_SECONDS} seconds (←)`}
              >
                <SkipIcon />
              </SeekButton>
              <SeekButton
                seconds={SKIP_SECONDS}
                className="vbar-btn"
                aria-label={`Forward ${SKIP_SECONDS} seconds`}
                title={`Forward ${SKIP_SECONDS} seconds (→)`}
              >
                <SkipIcon forward />
              </SeekButton>
              <div className="vbar-volume">
                <MuteButton
                  className="vbar-btn"
                  render={(props, state) => (
                    <button {...props} title={state.muted ? "Unmute (M)" : "Mute (M)"}>
                      <PlayerIcon name={state.muted ? "mute" : "volume"} />
                    </button>
                  )}
                />
                <VolumeSlider.Root className="vslider vslider--volume">
                  <VolumeSlider.Track className="vslider-track">
                    <VolumeSlider.Fill className="vslider-fill" />
                  </VolumeSlider.Track>
                  <VolumeSlider.Thumb className="vslider-thumb" />
                </VolumeSlider.Root>
              </div>
              <Time.Group className="vbar-time">
                <Time.Value type="current" />
                <Time.Separator> / </Time.Separator>
                <Time.Value type="duration" />
              </Time.Group>
              <span className="vbar-grow" aria-hidden="true" />
              {hasSubtitles ? (
                <button
                  type="button"
                  className={`vbar-btn vbar-cc ${showing ? "is-on" : ""}`}
                  aria-label="Subtitles"
                  aria-pressed={Boolean(showing)}
                  title={showing ? "Subtitles off (C)" : "Subtitles on (C)"}
                  onClick={toggleCaptions}
                >
                  <PlayerIcon name="cc" />
                </button>
              ) : null}
              <button
                ref={gearRef}
                type="button"
                className={`vbar-btn ${menu ? "is-open" : ""}`}
                aria-label="Settings"
                aria-haspopup="menu"
                aria-expanded={Boolean(menu)}
                title="Settings"
                onClick={() => setMenu(menu ? null : "main")}
              >
                <PlayerIcon name="gear" />
              </button>
              <FullscreenButton
                className="vbar-btn"
                render={(props, state) => (
                  <button
                    {...props}
                    title={state.fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
                  >
                    <PlayerIcon name={state.fullscreen ? "exitFullscreen" : "fullscreen"} />
                  </button>
                )}
              />
            </Controls.Group>
          </div>

          {menu ? (
            <div
              ref={menuRef}
              className="vmenu"
              role="menu"
              aria-label={menu === "main" ? "Settings" : menu[0].toUpperCase() + menu.slice(1)}
              onKeyDown={onMenuKey}
            >
              {menu === "main" ? (
                <>
                  <p className="vmenu-title" aria-hidden="true">
                    Settings
                  </p>
                  <MenuRow
                    icon="speed"
                    label="Playback speed"
                    value={speedLabel(rate)}
                    onClick={() => setMenu("speed")}
                  />
                  {autoplay ? (
                    <MenuRow
                      icon="autoplay"
                      label="Autoplay next"
                      value={autoplay.on ? "On" : "Off"}
                      checked={autoplay.on}
                      onClick={autoplay.toggle}
                    />
                  ) : null}
                  {stable ? (
                    <MenuRow
                      icon="wave"
                      label="Stable volume"
                      hint="Evens out loud and quiet parts"
                      value={stable.enabled ? "On" : "Off"}
                      checked={stable.enabled}
                      onClick={stable.toggle}
                    />
                  ) : null}
                  {audio.options.length > 1 ? (
                    <MenuRow
                      icon="audio"
                      label="Audio"
                      value={label(audio.options, audio.current) ?? "Default"}
                      onClick={() => setMenu("audio")}
                    />
                  ) : null}
                  {enhance ? (
                    <MenuRow
                      icon="sparkle"
                      label="Anime4K"
                      hint="Sharper lines, upscaled on your GPU"
                      value={ENHANCE_LABELS[enhance.mode]}
                      onClick={() => setMenu("enhance")}
                    />
                  ) : null}
                  <MenuRow
                    icon="cc"
                    label="Subtitles"
                    value={
                      showing
                        ? (label(subtitles.options, showing) ?? "On")
                        : hasSubtitles
                          ? "Off"
                          : "None"
                    }
                    onClick={() => setMenu("subtitles")}
                  />
                </>
              ) : menu === "subtitles" ? (
                <>
                  <MenuBack label="Subtitles" onClick={() => setMenu("main")} />
                  {hasSubtitles ? (
                    <div className="vmenu-list">
                      {[{ id: null as string | null, label: "Off" }, ...subtitles.options].map(
                        (option) => (
                          <MenuChoice
                            key={option.id ?? "off"}
                            label={option.label}
                            checked={showing === option.id}
                            onClick={() => subtitles.choose(option.id)}
                          />
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="vmenu-empty">This episode has no subtitles.</p>
                  )}
                </>
              ) : menu === "enhance" && enhance ? (
                <>
                  <MenuBack label="Anime4K" onClick={() => setMenu("main")} />
                  <div className="vmenu-list">
                    {(["off", "light", "strong"] as const).map((mode) => (
                      <MenuChoice
                        key={mode}
                        label={
                          mode === "off"
                            ? "Off"
                            : mode === "light"
                              ? "Light · one fast pass"
                              : "Strong · full Anime4K preset"
                        }
                        checked={enhance.mode === mode}
                        onClick={() => enhance.choose(mode)}
                      />
                    ))}
                  </div>
                  {enhance.detail ? <p className="vmenu-empty">{enhance.detail}</p> : null}
                </>
              ) : menu === "audio" ? (
                <>
                  <MenuBack label="Audio" onClick={() => setMenu("main")} />
                  <div className="vmenu-list">
                    {audio.options.map((option) => (
                      <MenuChoice
                        key={option.id}
                        label={option.label}
                        checked={audio.current === option.id}
                        onClick={() => audio.choose(option.id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <MenuBack label="Playback speed" onClick={() => setMenu("main")} />
                  {SPEEDS.map((value) => (
                    <MenuChoice
                      key={value}
                      label={value === 1 ? "1.00× · Normal" : speedLabel(value)}
                      checked={rate === value}
                      onClick={() => setRate(value)}
                    />
                  ))}
                </>
              )}
            </div>
          ) : null}
        </Controls.Content>
      </Controls.Root>
    </>
  );
}

/** One Settings row: icon, label, current value; a page opens behind the chevron. */
function MenuRow({
  icon,
  label,
  hint,
  value,
  checked,
  onClick,
}: {
  icon: Parameters<typeof PlayerIcon>[0]["name"];
  label: string;
  hint?: string;
  value: string;
  /** Set for on/off rows, which toggle in place. */
  checked?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const toggle = checked !== undefined;
  return (
    <button
      type="button"
      role={toggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={toggle ? checked : undefined}
      className="vmenu-row"
      onClick={onClick}
    >
      <PlayerIcon name={icon} />
      <span className="vmenu-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={`vmenu-value${toggle && checked ? " is-on" : ""}`}>{value}</span>
      {toggle ? (
        <span className="vmenu-chev-space" aria-hidden="true" />
      ) : (
        <PlayerIcon name="forward" className="vmenu-chev" />
      )}
    </button>
  );
}

function MenuBack({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" role="menuitem" className="vmenu-head" onClick={onClick}>
      <PlayerIcon name="back" />
      {label}
    </button>
  );
}

function MenuChoice({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="vmenu-row vmenu-row--check"
      onClick={onClick}
    >
      <PlayerIcon name="check" className="vmenu-tick" />
      <span className="vmenu-label">{label}</span>
    </button>
  );
}

/**
 * Full-width seek bar. While the pointer is over it, the preview shows the frame at that point
 * (from the low-quality preview copy) above the time.
 */
function SeekBar({
  video,
  thumbnails,
}: {
  video: HTMLVideoElement | null;
  thumbnails?: SeekThumbnails | null;
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !thumbnails || !video) return;
    let timer = 0;
    const onMove = (event: PointerEvent): void => {
      window.clearTimeout(timer);
      const box = root.getBoundingClientRect();
      const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const time = share * (video.duration || 0);
      // A short pause first, so sweeping across the bar does not seek the preview copy each pixel.
      timer = window.setTimeout(() => {
        thumbnails.request(time, (frame) => {
          const context = canvasRef.current?.getContext("2d");
          if (!context) return;
          context.drawImage(frame, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
          setHasFrame(true);
        });
      }, 90);
    };
    const onLeave = (): void => {
      window.clearTimeout(timer);
      setHasFrame(false);
    };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, [thumbnails, video]);
  return (
    <TimeSlider.Root className="vslider vslider--seek" ref={rootRef}>
      <TimeSlider.Track className="vslider-track">
        <TimeSlider.Buffer className="vslider-buffer" />
        <TimeSlider.Fill className="vslider-fill" />
      </TimeSlider.Track>
      <TimeSlider.Thumb className="vslider-thumb" />
      <TimeSlider.Preview className="vslider-preview">
        {thumbnails ? (
          <canvas
            ref={canvasRef}
            className={`vslider-frame${hasFrame ? " is-ready" : ""}`}
            width={THUMB_WIDTH}
            height={THUMB_HEIGHT}
            aria-hidden="true"
          />
        ) : null}
        <span className="vslider-preview-time">
          <TimeSlider.Value type="pointer" />
        </span>
      </TimeSlider.Preview>
    </TimeSlider.Root>
  );
}

/**
 * "Skip opening" / "Skip ending": appears while one plays, its fill sweeping across as the
 * segment runs, so the time left is visible at a glance.
 */
function SkipSegmentButton({
  segment,
  progress,
  next,
  go,
}: {
  segment: AnimeSkipSegment;
  progress: number;
  next?: string;
  go: () => void;
}): React.JSX.Element {
  const toNext = segment.kind === "ending" && next !== undefined;
  const left = Math.max(
    0,
    Math.round(segment.end - segment.start - progress * (segment.end - segment.start)),
  );
  return (
    <button
      type="button"
      className="vplayer-skip"
      onClick={go}
      aria-label={toNext ? `Next episode: ${next}` : undefined}
      title={toNext ? `Skip the ending and play ${next}` : `Skip to ${clock(segment.end)}`}
      style={
        { "--skip-progress": String(Math.min(1, Math.max(0, progress))) } as React.CSSProperties
      }
    >
      <span className="vplayer-skip-fill" aria-hidden="true" />
      <PlayerIcon name={toNext ? "next" : "skip"} />
      <span>
        {toNext ? "Next episode" : segment.kind === "opening" ? "Skip opening" : "Skip ending"}
      </span>
      {toNext ? <small className="vplayer-next-title">{next}</small> : null}
      <small aria-hidden="true">{clock(left)}</small>
    </button>
  );
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
