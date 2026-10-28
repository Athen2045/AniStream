import type { EnhanceMode } from "./anime4k-enhancer";

/**
 * Own-player conveniences kept in this device's local storage (ported from the user's own player,
 * 2026-10-18): volume and mute, autoplay, the last subtitle and audio language, and the last
 * measured connection speed. Losing them only resets the player to its defaults.
 */
const VOLUME_KEY = "anistream.player.volume";
const AUTOPLAY_KEY = "anistream.player.autoplay";
const SUBTITLE_KEY = "anistream.player.subtitles";
const AUDIO_KEY = "anistream.player.audio";
const BANDWIDTH_KEY = "anistream.player.bandwidth";
const ENHANCE_KEY = "anistream.player.enhance";
/** Anime4K is on hold as an experiment (user decision 2026-10-28): hidden unless this is "on". */
const ENHANCE_EXPERIMENT_KEY = "anistream.experimental.anime4k";
/** Bits per second; outside this range a saved estimate is ignored. */
const BANDWIDTH_RANGE = [250_000, 200_000_000] as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A convenience only.
  }
}

export function readVideoVolume(): { volume: number; muted: boolean } | null {
  try {
    const saved = JSON.parse(read(VOLUME_KEY) ?? "null") as {
      volume?: unknown;
      muted?: unknown;
    } | null;
    if (!saved || typeof saved.volume !== "number" || saved.volume < 0 || saved.volume > 1)
      return null;
    return { volume: saved.volume, muted: saved.muted === true };
  } catch {
    return null;
  }
}

export function writeVideoVolume(volume: number, muted: boolean): void {
  write(VOLUME_KEY, JSON.stringify({ volume, muted }));
}

export function readAutoplay(): boolean {
  return read(AUTOPLAY_KEY) !== "off";
}

export function writeAutoplay(on: boolean): void {
  write(AUTOPLAY_KEY, on ? "on" : "off");
}

/** The subtitle choice applied to every episode: off, or a language (e.g. `en`). */
export type SubtitleChoice = { enabled: boolean; language?: string };

export function readSubtitleChoice(): SubtitleChoice {
  try {
    const saved = JSON.parse(read(SUBTITLE_KEY) ?? "null") as SubtitleChoice | null;
    if (!saved || typeof saved.enabled !== "boolean") return { enabled: true, language: "en" };
    return {
      enabled: saved.enabled,
      ...(typeof saved.language === "string" ? { language: saved.language } : {}),
    };
  } catch {
    return { enabled: true, language: "en" };
  }
}

export function writeSubtitleChoice(choice: SubtitleChoice): void {
  write(SUBTITLE_KEY, JSON.stringify(choice));
}

/** The last audio language picked in the player (e.g. `ja`, `en`), if any. */
export function readAudioLanguage(): string | undefined {
  return read(AUDIO_KEY) ?? undefined;
}

export function writeAudioLanguage(language: string): void {
  write(AUDIO_KEY, language);
}

/**
 * Anime4K is an experiment on hold (2026-10-28): switching it on in full screen closed the app in
 * testing, so it stays hidden and off unless a developer sets `anistream.experimental.anime4k` to
 * "on" in this device's storage.
 */
export function anime4kExperimentEnabled(): boolean {
  return read(ENHANCE_EXPERIMENT_KEY) === "on";
}

/** Anime4K in the own player: off unless the viewer turns it on (it works the GPU hard). */
export function readEnhanceMode(): EnhanceMode {
  if (!anime4kExperimentEnabled()) return "off";
  const saved = read(ENHANCE_KEY);
  return saved === "light" || saved === "strong" ? saved : "off";
}

export function writeEnhanceMode(mode: EnhanceMode): void {
  write(ENHANCE_KEY, mode);
}

/** The base language of a tag: `pt-BR` → `pt`, `eng` → `eng` (lower-cased). */
export function baseLanguage(tag: string | undefined): string {
  return (tag ?? "").split(/[-_]/)[0].toLowerCase();
}

/**
 * The connection speed the stream library measured last time, so the next episode starts at the
 * quality the connection can carry instead of the library's 500 kbit/s guess (lowest quality,
 * then climbing). It keeps adjusting from there.
 */
export function readBandwidthEstimate(): number | undefined {
  const saved = Number(read(BANDWIDTH_KEY));
  return Number.isFinite(saved) && saved >= BANDWIDTH_RANGE[0] && saved <= BANDWIDTH_RANGE[1]
    ? saved
    : undefined;
}

export function writeBandwidthEstimate(bitsPerSecond: number): void {
  if (
    Number.isFinite(bitsPerSecond) &&
    bitsPerSecond >= BANDWIDTH_RANGE[0] &&
    bitsPerSecond <= BANDWIDTH_RANGE[1]
  )
    write(BANDWIDTH_KEY, String(Math.round(bitsPerSecond)));
}
