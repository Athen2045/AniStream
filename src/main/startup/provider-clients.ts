import { AnimeSourceClient } from "../anime-source";
import { AnimeDirectSource } from "../anime-direct-source";
import { AniZipClient } from "../anizip";
import type { AppDatabase } from "../database";
import { KitsuClient } from "../kitsu";
import { MalClient } from "../mal";
import { MalSyncClient } from "../malsync";
import { MangaBakaClient } from "../mangabaka";
import { MangaDexClient } from "../mangadex";
import { MangaMirrorClient } from "../manga-mirror";
import { MangaUpdatesClient } from "../mangaupdates";
import {
  isDatabaseEnabled,
  type AnimeDirectHlsProvider,
  type AnimeIndexedEmbedProvider,
  type MangaChapterMirrorProvider,
  type ProviderConfig,
} from "../provider-config";
import { TmdbClient } from "../tmdb";

export interface ProviderClients {
  mangaDex: MangaDexClient;
  tmdb: TmdbClient;
  mal?: MalClient;
  mangaBaka?: MangaBakaClient;
  mangaMirror?: MangaMirrorClient;
  mangaUpdates?: MangaUpdatesClient;
  kitsu?: KitsuClient;
  aniZip?: AniZipClient;
  animeSource?: AnimeSourceClient;
  animeDirect?: AnimeDirectSource;
}

/**
 * The data and playback clients the provider config enables. Each optional source is left out
 * when its config entry is missing, so a removed source never breaks the rest of the app.
 */
export function createProviderClients(
  config: ProviderConfig,
  database: () => AppDatabase | undefined,
): ProviderClients {
  // The database opens concurrently; until it is ready the reader uses MangaDex's default nodes.
  // One MAL-Sync client (and cache) serves the MangaDex mapping hint and the chapter mirror.
  const malSync = new MalSyncClient();
  const mangaDex = new MangaDexClient(undefined, undefined, {
    mappingHint: async (aniListId, signal) =>
      (await malSync.getSitePages(aniListId, "Mangadex", signal)).pages.map(
        (page) => page.identifier,
      ),
    forcePort443: () => {
      try {
        return database()?.getReaderSettings().standardPortOnly ?? false;
      } catch {
        return false;
      }
    },
    mappingStore: () => database()?.mangaDexMappings,
  });
  const clients: ProviderClients = { mangaDex, tmdb: new TmdbClient() };
  if (isDatabaseEnabled(config, "anime", "mal") || isDatabaseEnabled(config, "manga", "mal"))
    clients.mal = new MalClient();
  if (isDatabaseEnabled(config, "manga", "mangabaka")) clients.mangaBaka = new MangaBakaClient();
  // Optional, user-approved chapter mirror; absent unless the local provider config enables it.
  const mirrorConfig = config.manga.media.find(
    (entry): entry is MangaChapterMirrorProvider => entry.kind === "chapter-mirror",
  );
  if (mirrorConfig) clients.mangaMirror = new MangaMirrorClient(mirrorConfig, { mapping: malSync });
  if (isDatabaseEnabled(config, "manga", "mangaupdates"))
    clients.mangaUpdates = new MangaUpdatesClient();
  // Kitsu episode thumbnails ship in every build.
  if (isDatabaseEnabled(config, "anime", "kitsu")) clients.kitsu = new KitsuClient();
  if (isDatabaseEnabled(config, "anime", "anizip")) clients.aniZip = new AniZipClient();
  // The embedded anime player, plus (trial 2026-10-18) a direct-stream source for the own player.
  const animePlayer = config.anime.media.find(
    (entry): entry is AnimeIndexedEmbedProvider => entry.kind === "indexed-embed",
  );
  if (animePlayer && isAnimeSourceEnabled())
    clients.animeSource = new AnimeSourceClient(animePlayer);
  const directConfig = config.anime.media.find(
    (entry): entry is AnimeDirectHlsProvider => entry.kind === "direct-hls",
  );
  if (directConfig && isAnimeSourceEnabled())
    clients.animeDirect = new AnimeDirectSource(directConfig);
  return clients;
}

/** The `ANISTREAM_ANIME_SOURCE_ENABLED` kill switch: "0", "false" or "off" turns playback off. */
export function isAnimeSourceEnabled(): boolean {
  const configured = process.env.ANISTREAM_ANIME_SOURCE_ENABLED?.trim().toLocaleLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}
