import type { AnimeEpisodeArt } from "../shared/contracts";

/**
 * Kitsu episode thumbnails for an AniList anime (trial 2026-10-13).
 *
 * Identity is Kitsu's own exact mapping record (`externalSite` `anilist/anime`, `externalId` the
 * AniList ID), never title text. Kitsu splits shows into one entry per season or cour the way
 * AniList does and numbers each entry's episodes from 1, so episode N maps to episode N without
 * the air-date anchoring TMDB needs. Kitsu pages hold at most 20 episodes; long series load the
 * pages around the viewer's episode first within a fixed page budget.
 */

/** Kitsu's documented maximum page size. */
export const KITSU_EPISODE_PAGE_SIZE = 20;
/** Episode pages per lookup (120 episodes around the focus). Application policy. */
export const MAX_KITSU_EPISODE_PAGES = 6;
export const MAX_KITSU_EPISODES = 2_000;
const IMAGE_HOSTS = new Set(["media.kitsu.app", "media.kitsu.io"]);

/** The single Kitsu anime ID that an exact AniList mapping names, or undefined. */
export function parseKitsuAnimeMapping(payload: unknown, aniListId: number): number | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const ids = new Set<string>();
  for (const mapping of payload.data) {
    if (!isRecord(mapping) || mapping.type !== "mappings") continue;
    const attributes = isRecord(mapping.attributes) ? mapping.attributes : undefined;
    if (
      attributes?.externalSite !== "anilist/anime" ||
      attributes.externalId !== String(aniListId)
    ) {
      continue;
    }
    const relationships = isRecord(mapping.relationships) ? mapping.relationships : undefined;
    const item = relationships && isRecord(relationships.item) ? relationships.item : undefined;
    const data = item && isRecord(item.data) ? item.data : undefined;
    if (data?.type === "anime" && typeof data.id === "string" && /^\d+$/.test(data.id)) {
      ids.add(data.id);
    }
  }
  // Two Kitsu entries claiming one AniList ID is ambiguous: show no art rather than guess.
  return ids.size === 1 ? Number([...ids][0]) : undefined;
}

/** Page offsets to request, nearest the focus episode first, within the page budget. */
export function planKitsuEpisodePages(episodes: number, focus: number): number[] {
  const total = Math.min(Math.max(0, Math.floor(episodes)), MAX_KITSU_EPISODES);
  if (!total) return [];
  const pageCount = Math.ceil(total / KITSU_EPISODE_PAGE_SIZE);
  const focusPage = Math.floor((Math.min(Math.max(1, focus), total) - 1) / KITSU_EPISODE_PAGE_SIZE);
  return Array.from({ length: pageCount }, (_, page) => page)
    .sort((a, b) => Math.abs(a - focusPage) - Math.abs(b - focusPage) || a - b)
    .slice(0, MAX_KITSU_EPISODE_PAGES)
    .map((page) => page * KITSU_EPISODE_PAGE_SIZE);
}

/** Episode thumbnails from one Kitsu episodes page, keyed by Kitsu's own episode number. */
export function parseKitsuEpisodeArt(payload: unknown, episodes: number): AnimeEpisodeArt[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const total = Math.min(Math.max(0, Math.floor(episodes)), MAX_KITSU_EPISODES);
  return payload.data.flatMap((episode): AnimeEpisodeArt[] => {
    if (!isRecord(episode) || episode.type !== "episodes") return [];
    const attributes = isRecord(episode.attributes) ? episode.attributes : undefined;
    const number = attributes?.number;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > total) {
      return [];
    }
    const thumbnail = isRecord(attributes?.thumbnail) ? attributes.thumbnail : undefined;
    const stillUrl =
      readImageUrl(thumbnail?.large) ??
      readImageUrl(thumbnail?.medium) ??
      readImageUrl(thumbnail?.original);
    return stillUrl ? [{ number, stillUrl }] : [];
  });
}

function readImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname) && !url.username
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
