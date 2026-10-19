/**
 * Offline artwork: AniList (and dev-only Kitsu) images shown for Continue titles, the catalog hero,
 * and title pages load through this scheme, so the main process keeps a bounded local copy that
 * still renders when AniList or the network is down. Only these image hosts are ever fetched.
 */
export const ARTWORK_SCHEME = "anistream-art";

const ARTWORK_HOSTS = new Set([
  "s4.anilist.co",
  "img.anili.st",
  "media.kitsu.app",
  "media.kitsu.io",
]);

export function isCacheableArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ARTWORK_HOSTS.has(url.hostname) && !url.username;
  } catch {
    return false;
  }
}

/** The cached form of an artwork URL; other URLs are returned unchanged. */
export function cachedArtworkUrl(value: string): string;
export function cachedArtworkUrl(value: string | undefined): string | undefined;
export function cachedArtworkUrl(value: string | undefined): string | undefined {
  if (!value || !isCacheableArtworkUrl(value)) return value;
  return `${ARTWORK_SCHEME}://image/?src=${encodeURIComponent(value)}`;
}

/** Reverses `cachedArtworkUrl`; undefined for anything that is not an allowed artwork URL. */
export function artworkSourceFromCacheUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== `${ARTWORK_SCHEME}:` || url.hostname !== "image") return undefined;
    const source = url.searchParams.get("src");
    return source && isCacheableArtworkUrl(source) ? source : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Anime episode thumbnails get their own scheme host and a separate bounded cache, so a long
 * series cannot evict the cover/banner artwork kept for offline use. The main process fetches
 * them, so image hosts never see the renderer.
 */
const EPISODE_ART_HOSTS = new Set([
  "artworks.thetvdb.com",
  "media.kitsu.app",
  "media.kitsu.io",
  "image.tmdb.org",
]);

export function isEpisodeArtUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EPISODE_ART_HOSTS.has(url.hostname) && !url.username;
  } catch {
    return false;
  }
}

/** The cached form of an episode thumbnail; other URLs are returned unchanged. */
export function cachedEpisodeArtUrl(value: string): string {
  if (!isEpisodeArtUrl(value)) return value;
  return `${ARTWORK_SCHEME}://episode/?src=${encodeURIComponent(value)}`;
}

/** Reverses `cachedEpisodeArtUrl`; undefined for anything that is not an allowed episode image. */
export function episodeArtSourceFromCacheUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== `${ARTWORK_SCHEME}:` || url.hostname !== "episode") return undefined;
    const source = url.searchParams.get("src");
    return source && isEpisodeArtUrl(source) ? source : undefined;
  } catch {
    return undefined;
  }
}
