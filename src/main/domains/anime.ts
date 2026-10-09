import type { AnimeSourceClient } from "../anime-source";
import type { AniListClient } from "../anilist";
import type { AnimeTmdbLinks } from "../anime-tmdb-links";
import { animeEpisodeArt } from "../anime-episode-art";
import { createBoundedCache } from "../anilist/cache";
import type { TmdbClient } from "../tmdb";
import type { AnimeEpisodeArt } from "../../shared/contracts";
import type { MalClient } from "../mal";
import { registerTrustedIpcHandler } from "../ipc";

export interface AnimeDomainDeps {
  animeSource: AnimeSourceClient | undefined;
  mal: MalClient | undefined;
  /** TMDB episode stills: exact Wikidata links, TMDB, and AniList start dates. */
  episodeArt?: { links: AnimeTmdbLinks; tmdb: TmdbClient; aniList: AniListClient };
}

/** Configured anime source episode discovery/playback, plus MAL score and trending fallback. */
export function registerAnimeDomain(
  trustedRendererOrigin: string,
  { animeSource, mal, episodeArt }: AnimeDomainDeps,
): void {
  const artCache = createBoundedCache<AnimeEpisodeArt[]>({ maxEntries: 40, ttlMs: 6 * 3_600_000 });
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:episode-art", async (_event, input) => {
    if (!episodeArt) return [];
    // Long series fetch the TMDB seasons around the viewed episode, so the area is in the key.
    const key = `${input.aniListId}:${input.episodes}:${Math.floor(input.focus / 50)}`;
    const cached = artCache.get(key);
    if (cached) return cached;
    void episodeArt.links.refreshIfStale();
    try {
      const { art, complete } = await animeEpisodeArt(
        {
          links: () => episodeArt.links.index(),
          media: async (id) => {
            const detail = await episodeArt.aniList.getMediaDetail(id, "ANIME");
            return {
              startDate: detail.startDate,
              prequels: detail.relations
                .filter((row) => row.relationType === "PREQUEL" && row.media.type === "ANIME")
                .map((row) => row.media.id),
            };
          },
          detail: (id) => episodeArt.tmdb.getDetail(id, "TV"),
          season: (id, number) => episodeArt.tmdb.getSeason(id, number),
        },
        input,
      );
      if (complete) artCache.set(key, art);
      return art;
    } catch {
      // Stills are decoration: the episode list keeps its own artwork when TMDB is unavailable.
      return [];
    }
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:provider-readiness", async () => {
    if (!animeSource) {
      return {
        provider: "anime-source",
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: "Anime playback is not configured or is disabled on this device.",
      };
    }
    return animeSource.checkReadiness();
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:episode-catalog",
    async (_event, input) => {
      if (!animeSource) {
        return {
          status: "unavailable",
          provider: "anime-source",
          seasons: [],
          message: "Anime playback is not configured or is disabled on this device.",
          checkedAt: new Date().toISOString(),
        };
      }
      return animeSource.getEpisodeCatalog(input);
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:playback", async (_event, input) => {
    if (!animeSource) throw new Error("Anime playback is not configured.");
    return animeSource.getPlayback(input);
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
