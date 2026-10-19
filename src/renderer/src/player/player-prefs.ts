/**
 * Own-player conveniences kept in this device's local storage (ported from the user's own player,
 * 2026-10-18): volume and mute, autoplay, the last subtitle and audio language. Losing them only
 * resets the player to its defaults.
 */
const VOLUME_KEY = "anistream.player.volume";
const AUTOPLAY_KEY = "anistream.player.autoplay";
const SUBTITLE_KEY = "anistream.player.subtitles";
const AUDIO_KEY = "anistream.player.audio";

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

/** The base language of a tag: `pt-BR` → `pt`, `eng` → `eng` (lower-cased). */
export function baseLanguage(tag: string | undefined): string {
  return (tag ?? "").split(/[-_]/)[0].toLowerCase();
}
