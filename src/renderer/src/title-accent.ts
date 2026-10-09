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
