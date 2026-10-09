import type { PicturePalette } from "../shared/contracts";

/**
 * Three hero colours from a small BGRA bitmap (Electron `nativeImage.toBitmap()` order): the
 * average of the left, middle and right thirds, pushed toward a vivid mid-lightness so a dull or
 * dark picture still gives a readable gradient behind white text.
 */
export function paletteFromBitmap(bgra: Uint8Array, width: number, height: number): PicturePalette {
  const thirds = [0, 1, 2].map((band) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const from = Math.floor((band * width) / 3);
    const to = Math.max(from + 1, Math.floor(((band + 1) * width) / 3));
    for (let y = 0; y < height; y += 1)
      for (let x = from; x < Math.min(to, width); x += 1) {
        const i = (y * width + x) * 4;
        if (i + 3 >= bgra.length || bgra[i + 3] < 128) continue;
        b += bgra[i];
        g += bgra[i + 1];
        r += bgra[i + 2];
        n += 1;
      }
    return n ? vivid(r / n, g / n, b / n) : "#369d73";
  });
  return [thirds[0], thirds[1], thirds[2]];
}

function vivid(r: number, g: number, b: number): string {
  const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
  // A near-grey third keeps its hue but gets enough colour to read as a tint, not mud.
  return hslToHex(h, Math.min(0.85, Math.max(0.35, s * 1.4)), Math.min(0.62, Math.max(0.42, l)));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const k = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v =
      k < 1 / 6
        ? p + (q - p) * 6 * k
        : k < 1 / 2
          ? q
          : k < 2 / 3
            ? p + (q - p) * (2 / 3 - k) * 6
            : p;
    return Math.round(v * 255);
  };
  return `#${[channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}
