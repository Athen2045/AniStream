import { join } from "node:path";
import { protocol } from "electron";
import {
  ARTWORK_SCHEME,
  artworkSourceFromCacheUrl,
  episodeArtSourceFromCacheUrl,
  isEpisodeArtUrl,
} from "../../shared/artwork";
import { ArtworkCache } from "../artwork-cache";
import type { AppDatabase } from "../database";
import { keptStillSources } from "../downloads/download-extras";
import { PROVIDER_USER_AGENT } from "../provider-transport";

/**
 * The offline artwork caches behind the `anistream-art` scheme: covers and banners, and episode
 * stills in their own bounded cache. Downloaded titles keep their cover and stills.
 */
export function installArtwork(options: {
  userData: string;
  database: () => AppDatabase | undefined;
}): { episodeArtCache: ArtworkCache; saveDownloadCovers: () => void } {
  const { database } = options;
  const downloadCovers = (): string[] =>
    [
      ...(database()?.downloads.list() ?? []),
      ...(database()?.chapterDownloads.list() ?? []),
    ].flatMap((item) => (item.coverUrl ? [item.coverUrl] : []));
  const artworkCache = new ArtworkCache({
    directory: join(options.userData, "artwork-cache"),
    userAgent: PROVIDER_USER_AGENT,
    // Downloaded titles keep their cover, so the offline Downloaded row is never blank.
    keep: downloadCovers,
  });
  const savedCovers = new Set<string>();
  const saveDownloadCovers = (): void => {
    for (const url of downloadCovers()) {
      if (savedCovers.has(url)) continue;
      savedCovers.add(url);
      // Fetched now, while online; a failure is retried on the next downloads change.
      void artworkCache.get(url).then((artwork) => artwork || savedCovers.delete(url));
    }
  };
  // Episode thumbnails have their own bounded cache so they never evict offline covers.
  const episodeArtCache = new ArtworkCache({
    directory: join(options.userData, "episode-art-cache"),
    userAgent: PROVIDER_USER_AGENT,
    allows: isEpisodeArtUrl,
    maxBytes: 60 * 1024 * 1024,
    maxFiles: 800,
    // Downloaded titles keep their episode stills, so their episodes still preview offline.
    keep: () => {
      const opened = database();
      return opened ? keptStillSources(opened.titleCopies) : [];
    },
  });
  // Only allowlisted artwork and episode-image URLs resolve; the renderer never names a file.
  protocol.handle(ARTWORK_SCHEME, async (request) => {
    const episodeSource = episodeArtSourceFromCacheUrl(request.url);
    const source = episodeSource ?? artworkSourceFromCacheUrl(request.url);
    const cache = episodeSource ? episodeArtCache : artworkCache;
    const artwork = source ? await cache.get(source) : undefined;
    if (!artwork) return new Response(null, { status: source ? 404 : 400 });
    return new Response(artwork.body, {
      headers: { "Content-Type": artwork.contentType, "Cache-Control": "no-store" },
    });
  });
  return { episodeArtCache, saveDownloadCovers };
}
