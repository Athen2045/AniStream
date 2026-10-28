import { readFile, rm, writeFile } from "node:fs/promises";
import { registerTrustedIpcHandler } from "../ipc";
import { isMissingFileError } from "../anilist/session-store";

/**
 * Profile look: the viewer's own hero image, a cropped JPEG kept only in this device's app data.
 * (The colours of the chosen picture are read in the renderer, see shared/picture-palette.ts.)
 */
export function registerProfileDomain(origin: string, options: { heroPath: string }): void {
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

function jpegDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
