import { withTitleCopy, type TitleCopies } from "../title-copies";
import type { AnimeSourceClient } from "../anime-source";
import type { AniListClient } from "../anilist";
import type { AnimeTmdbLinks } from "../anime-tmdb-links";
import { animeEpisodeArt } from "../anime-episode-art";
import { animeEpisodeRanges } from "../anime-episode-ranges";
import type { AniZipClient } from "../anizip";
import { createBoundedCache } from "../anilist/cache";
import { chainEpisodeArt, type EpisodeArtSource } from "../episode-art-sources";
import type { KitsuClient } from "../kitsu";
import type { SkipTimesClient } from "../skip-times";
import type { TmdbClient } from "../tmdb";
import { cachedEpisodeArtUrl } from "../../shared/artwork";
import type { AnimeEpisodeArt, AnimeEpisodeRanges, AnimeSkipSegment } from "../../shared/contracts";
import { skipTimesCopyKey } from "../downloads/download-extras";
import type { MalClient } from "../mal";
import { registerTrustedIpcHandler } from "../ipc";

export interface AnimeDomainDeps {
  animeSource: AnimeSourceClient | undefined;
  mal: MalClient | undefined;
  /**
   * Episode thumbnail sources, tried in this order (user decision 2026-10-13); each is optional.
   * TMDB stills need exact Wikidata links, TMDB, and AniList start dates.
   */
  /** Saved title-page data, served when a live load fails (offline). */
  copies?: TitleCopies;
  /** Opening/ending times for the own player's Skip buttons. */
  skipTimes?: SkipTimesClient;
  episodeArt?: {
    anizip?: AniZipClient;
    kitsu?: KitsuClient;
    tmdb?: { links: AnimeTmdbLinks; tmdb: TmdbClient; aniList: AniListClient };
  };
}

/** Configured anime source episode discovery/playback, plus MAL score and trending fallback. */
export function registerAnimeDomain(
  trustedRendererOrigin: string,
  { animeSource, mal, episodeArt, copies, skipTimes }: AnimeDomainDeps,
): void {
  // Saved with the title (and for each download, `download-extras.ts`), so a downloaded episode
  // can still skip its opening offline. The player's length can differ from the length the times
  // were saved under by a second or two, so a nearby saved cut also counts.
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:skip-times", async (_event, input) => {
    if (!skipTimes) return [];
    const { aniListId, episode, durationSeconds } = input;
    return withTitleCopy(
      copies,
      skipTimesCopyKey(aniListId, episode, durationSeconds),
      aniListId,
      () => skipTimes.getSkipTimes(input),
    ).catch(() => {
      for (const offset of [-1, 1, -2, 2]) {
        const saved = copies?.read(skipTimesCopyKey(aniListId, episode, durationSeconds + offset));
        if (Array.isArray(saved)) return saved as AnimeSkipSegment[];
      }
      return [];
    });
  });
  const artCache = createBoundedCache<AnimeEpisodeArt[]>({ maxEntries: 40, ttlMs: 6 * 3_600_000 });
  const artSources = episodeArtSources(episodeArt);
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:episode-art", async (_event, input) => {
    if (!artSources.length) return [];
    // Long series load the thumbnails around the viewed episode, so the area is in the key.
    const key = `${input.aniListId}:${input.episodes}:${Math.floor(input.focus / 50)}`;
    const cached = artCache.get(key);
    if (cached) return cached;
    return withTitleCopy(
      copies,
      `art:${key}`,
      input.aniListId,
      async () => {
        // Thumbnails are decoration: a failed source leaves the episode list's own artwork.
        const { art, complete } = await chainEpisodeArt(artSources, input);
        // Served through the episode-art cache, so image hosts never see the renderer.
        const served = art.map((row) =>
          row.stillUrl ? { ...row, stillUrl: cachedEpisodeArtUrl(row.stillUrl) } : row,
        );
        if (complete) artCache.set(key, served);
        return served;
      },
      (served) => served.length > 0,
    );
  });
  const rangeCache = createBoundedCache<AnimeEpisodeRanges | null>({
    maxEntries: 40,
    ttlMs: 24 * 3_600_000,
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:episode-ranges",
    async (_event, input) => {
      const anizip = episodeArt?.anizip;
      if (!anizip) return undefined;
      const key = `${input.aniListId}:${input.episodes}`;
      const cached = rangeCache.get(key);
      if (cached !== undefined) return cached ?? undefined;
      const tmdb = episodeArt.tmdb;
      const loadRanges = async () => {
        try {
          const ranges = await animeEpisodeRanges(
            {
              index: (id) => anizip.getTitle(id),
              tmdbTvId: tmdb
                ? (id) => {
                    const key = tmdb.links
                      .index()
                      .tmdbKeysFor(id)
                      .find((link) => link.startsWith("TV:"));
                    return key ? Number(key.slice(3)) : undefined;
                  }
                : undefined,
              storyArcs: tmdb ? (id) => tmdb.tmdb.getStoryArcs(id) : undefined,
              tvSeasons: tmdb
                ? async (id) => (await tmdb.tmdb.getDetail(id, "TV")).seasons
                : undefined,
            },
            input,
          );
          rangeCache.set(key, ranges ?? null);
          return ranges;
        } catch {
          // Ranges are a browsing aid: without them the episodes stay one list.
          return undefined;
        }
      };
      // The saved copy keeps a long series' arcs offline.
      return withTitleCopy(
        copies,
        `ranges:${input.aniListId}`,
        input.aniListId,
        loadRanges,
        (ranges) => ranges !== undefined,
      );
    },
  );
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
      // The saved list keeps the title page (and downloaded episodes) usable offline.
      return withTitleCopy(
        copies,
        `episodes:${input.aniListId}`,
        input.aniListId,
        () => animeSource.getEpisodeCatalog(input),
        // A bare AniList-count list (the index was unreachable) is not worth more than the copy.
        (catalog) => catalog.seasons.some((season) => !season.id.startsWith("anilist:")),
      );
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

function episodeArtSources(deps: AnimeDomainDeps["episodeArt"]): EpisodeArtSource[] {
  if (!deps) return [];
  const sources: EpisodeArtSource[] = [];
  const { anizip, kitsu, tmdb } = deps;
  if (anizip) {
    sources.push({
      load: async (input) => ({
        art: await anizip.getEpisodeArt(input.aniListId, input.episodes),
        complete: true,
      }),
    });
  }
  if (kitsu) sources.push({ load: (input) => kitsu.getEpisodeArt(input) });
  if (tmdb) {
    sources.push({
      load: (input) => {
        void tmdb.links.refreshIfStale();
        return animeEpisodeArt(
          {
            links: () => tmdb.links.index(),
            media: async (id) => {
              const detail = await tmdb.aniList.getMediaDetail(id, "ANIME");
              return {
                startDate: detail.startDate,
                prequels: detail.relations
                  .filter((row) => row.relationType === "PREQUEL" && row.media.type === "ANIME")
                  .map((row) => row.media.id),
              };
            },
            detail: (id) => tmdb.tmdb.getDetail(id, "TV"),
            season: (id, number) => tmdb.tmdb.getSeason(id, number),
          },
          input,
        );
      },
    });
  }
  return sources;
}
