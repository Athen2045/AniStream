import type { KitsuClient } from "../kitsu";
import { registerTrustedIpcHandler } from "../ipc";

/** Keeps the Kitsu hero experiment behind a development-only domain seam. */
export function registerKitsuDevelopmentDomain(
  trustedRendererOrigin: string,
  kitsu: KitsuClient,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "kitsu:hero-art", async (_event, input) => {
    return kitsu.getHeroArtwork(input);
  });
}
