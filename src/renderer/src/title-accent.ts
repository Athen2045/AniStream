import type { CSSProperties } from "react";

/**
 * Manga pages tint actions and progress with AniList's dominant cover color.
 * - `--title-accent-ink`: text on the accent, whichever of near-black/white contrasts more.
 * - `--title-accent-text`: the accent used as text on the dark page; very dark colors are
 *   lightened so labels stay readable.
 * Without a color the brand green from the stylesheet applies.
 */
export function titleAccentStyle(color: string | undefined): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const luminance = relativeLuminance(color);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return {
    "--title-accent": color,
    "--title-accent-ink": blackContrast >= whiteContrast ? "#0b0d0c" : "#ffffff",
    "--title-accent-text": luminance < 0.12 ? `color-mix(in srgb, ${color} 45%, #ffffff)` : color,
  } as CSSProperties;
}

export function relativeLuminance(color: string): number {
  const value = Number.parseInt(color.slice(1), 16);
  const [red, green, blue] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    },
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The title's own colour for its Watch / Read / Play button and page accents (TV-style UI,
 * user decision 2026-10-20). CSS softens it to a readable pastel (styles/tv-ui.css); greys carry
 * no real hue, so they get nothing here and the button falls back to the app's emerald.
 */
export function titleTintStyle(color: string | undefined): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  if (Math.max(...channels) - Math.min(...channels) < 28) return undefined;
  return { "--title-tint": color } as CSSProperties;
}
