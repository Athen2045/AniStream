import { readFile, rm, writeFile } from "node:fs/promises";
import { nativeImage } from "electron";
import type { PicturePalette } from "../../shared/contracts";
import { registerTrustedIpcHandler } from "../ipc";
import { isMissingFileError } from "../anilist/session-store";
import { isPicturePaletteUrl } from "../ipc-validation";
import { paletteFromBitmap } from "../picture-palette";

const PALETTE_TIMEOUT_MS = 10_000;
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const PALETTE_CACHE_SIZE = 20;

/**
 * Profile look: colours from the chosen picture (AniList or Simkl) for the hero gradient, and the
 * viewer's own hero image. The image is a cropped JPEG kept only in this device's app data.
 */
export function registerProfileDomain(
  origin: string,
  options: { heroPath: string; userAgent: string; fetcher?: typeof fetch },
): void {
  const fetcher = options.fetcher ?? fetch;
  const palettes = new Map<string, Promise<PicturePalette | undefined>>();

  registerTrustedIpcHandler(origin, "profile:palette", (_event, url) => {
    let pending = palettes.get(url);
    if (!pending) {
      pending = picturePalette(url, fetcher, options.userAgent).catch(() => undefined);
      palettes.set(url, pending);
      while (palettes.size > PALETTE_CACHE_SIZE) palettes.delete(palettes.keys().next().value!);
    }
    return pending;
  });
  registerTrustedIpcHandler(origin, "profile:hero", async () => {
    try {
      return jpegDataUrl(await readFile(options.heroPath));
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  });
  registerTrustedIpcHandler(origin, "profile:hero-set", async (_event, jpeg) => {
    const bytes = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
    await writeFile(options.heroPath, bytes);
    return jpegDataUrl(bytes);
  });
  registerTrustedIpcHandler(origin, "profile:hero-clear", () =>
    rm(options.heroPath, { force: true }),
  );
}

async function picturePalette(
  url: string,
  fetcher: typeof fetch,
  userAgent: string,
): Promise<PicturePalette | undefined> {
  if (!isPicturePaletteUrl(url)) return undefined;
  const response = await fetcher(url, {
    headers: { "User-Agent": userAgent },
    redirect: "error",
    signal: AbortSignal.timeout(PALETTE_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_PICTURE_BYTES) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PICTURE_BYTES) return undefined;
  // nativeImage decodes PNG and JPEG; anything else (GIF, WebP) falls back to the brand colours.
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return undefined;
  const small = image.resize({ width: 24, height: 24, quality: "good" });
  const { width, height } = small.getSize();
  return paletteFromBitmap(small.toBitmap(), width, height);
}

function jpegDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
