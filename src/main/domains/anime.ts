import type { AnikotoClient } from "../anikoto";
import type { MalClient } from "../mal";
import { registerTrustedIpcHandler } from "../ipc";

export interface AnimeDomainDeps {
  anikoto: AnikotoClient | undefined;
  mal: MalClient | undefined;
}

/** Anikoto episode discovery/playback, plus MAL score and trending fallback. */
export function registerAnimeDomain(
  trustedRendererOrigin: string,
  { anikoto, mal }: AnimeDomainDeps,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:provider-readiness", async () => {
    if (!anikoto) {
      return {
        provider: "anikoto",
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: "Anime playback is disabled in AniStream's local configuration.",
      };
    }
    return anikoto.checkReadiness();
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:episode-catalog",
    async (_event, input) => {
      if (!anikoto) {
        return {
          status: "unavailable",
          provider: "anikoto",
          seasons: [],
          message: "Anikoto is disabled in AniStream's local configuration.",
          checkedAt: new Date().toISOString(),
        };
      }
      return anikoto.getEpisodeCatalog(input);
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:playback", async (_event, input) => {
    if (!anikoto) throw new Error("Anikoto playback is disabled.");
    return anikoto.getPlayback(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "mal:score", async (_event, type, malId) => {
    if (!mal) throw new Error("MyAnimeList is not ready.");
    return mal.getScore(type, malId);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mal:trending-fallback",
    async (_event, type) => {
      if (!mal) throw new Error("MyAnimeList is not ready.");
      return mal.getRanking(type);
    },
  );
}
