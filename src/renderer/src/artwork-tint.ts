import { useEffect, useState } from "react";

const tints = new Map<string, string | null>();

/**
 * The dominant saturated colour of a poster, for titles without an AniList colour (More / TMDB).
 * Decodes a 92 px wide copy into a 16×24 canvas and picks the most common vivid colour bucket;
 * remembered per poster for the session. Undefined until known, or when the poster is too grey.
 */
export function useArtworkTint(posterUrl: string | undefined): string | undefined {
  const source = posterUrl ? smallPoster(posterUrl) : undefined;
  const [tint, setTint] = useState<{ source?: string; color?: string }>({});
  useEffect(() => {
    if (!source || tints.has(source)) return;
    let active = true;
    void dominantColor(source).then((color) => {
      tints.set(source, color ?? null);
      if (active) setTint({ source, color: color ?? undefined });
    });
    return () => {
      active = false;
    };
  }, [source]);
  if (!source) return undefined;
  if (tints.has(source)) return tints.get(source) ?? undefined;
  return tint.source === source ? tint.color : undefined;
}

/** TMDB serves sized copies; the smallest is plenty for a colour. */
function smallPoster(url: string): string {
  return url.replace(/\/t\/p\/(?:w\d+|original)\//, "/t/p/w92/");
}

async function dominantColor(url: string): Promise<string | undefined> {
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = new OffscreenCanvas(16, 24);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, 16, 24);
    return pickDominant(context.getImageData(0, 0, 16, 24).data);
  } catch {
    return undefined;
  }
}

/** Most common vivid colour (bucketed to 3 bits a channel), averaged within its bucket. */
export function pickDominant(pixels: Uint8ClampedArray): string | undefined {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    const [r, g, b] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 60 || max - min < 40) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number } | undefined;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  if (!best || best.count < 8) return undefined;
  const hex = (sum: number) =>
    Math.round(sum / best.count)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
