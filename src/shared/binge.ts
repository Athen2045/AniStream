import { isCacheableArtworkUrl } from "./artwork";

/**
 * Up Next and playlists: local, single-user lists of things to watch. Anime items refer to an
 * exact AniList ID and More items to an exact TMDB ID; each keeps a small display snapshot so the
 * lists render offline. Manga is not queueable (reading has its own Continue flow).
 */
export interface BingeAnime {
  id: number;
  title: string;
  /** Absent after a backup restore (backups carry no artwork) until the title is queued again. */
  coverUrl?: string;
  bannerUrl?: string;
  totalProgress?: number;
}

export interface BingeMore {
  id: number;
  type: "MOVIE" | "TV";
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  year?: number;
}

export type BingeItem =
  /** No episode: continue the show from the user's progress. */
  | { kind: "anime"; media: BingeAnime; episode?: number }
  | { kind: "more"; title: BingeMore; season?: number; episode?: number };

export interface BingeEntry {
  /** Stable identity within one list (see `bingeItemKey`); a list never holds a key twice. */
  key: string;
  item: BingeItem;
  addedAt: string;
}

export interface BingePlaylist {
  id: number;
  name: string;
  entries: BingeEntry[];
  updatedAt: string;
}

export interface BingeState {
  /** Up Next, in play order; an item leaves it when it starts playing. */
  queue: BingeEntry[];
  playlists: BingePlaylist[];
}

/** The list a change applies to: Up Next, or a saved playlist by ID. */
export type BingeListRef = { list: "queue" } | { list: "playlist"; id: number };

export type BingeChange =
  | { op: "add"; target: BingeListRef; item: BingeItem; position: "next" | "end" }
  | { op: "remove"; target: BingeListRef; key: string }
  | { op: "move"; target: BingeListRef; key: string; index: number }
  | { op: "clear"; target: BingeListRef }
  | { op: "create-playlist"; name: string; fromQueue: boolean }
  | { op: "rename-playlist"; id: number; name: string }
  | { op: "delete-playlist"; id: number }
  /** Replaces Up Next with a copy of the playlist (playing it does not change the playlist). */
  | { op: "queue-playlist"; id: number };

export const BINGE_LIST_LIMIT = 200;
export const BINGE_PLAYLIST_LIMIT = 50;
export const BINGE_NAME_MAX = 60;

export function bingeItemKey(item: BingeItem): string {
  if (item.kind === "anime")
    return `anime:${item.media.id}${item.episode ? `:e${item.episode}` : ""}`;
  return `more:${item.title.type}:${item.title.id}${item.season && item.episode ? `:s${item.season}e${item.episode}` : ""}`;
}

/** "Continue", "Episode 3", "S2 · E5", or "Movie" — what playing the item starts. */
export function bingeItemTarget(item: BingeItem): string {
  if (item.kind === "anime") return item.episode ? `Episode ${item.episode}` : "Continue watching";
  if (item.title.type === "MOVIE") return "Movie";
  return item.season && item.episode ? `S${item.season} · E${item.episode}` : "Continue watching";
}

const TMDB_IMAGE =
  /^https:\/\/image\.tmdb\.org\/t\/p\/w(?:300|500|780|1280)\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,239}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveInt(value: unknown, max = 2_147_483_647): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/**
 * Rebuilds an untrusted item from allowed fields only. Artwork must be an allowlisted AniList or
 * TMDB image URL, so stored lists can never point the renderer at an arbitrary host.
 */
export function parseBingeItem(value: unknown): BingeItem | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  if (raw.kind === "anime") {
    const media = record(raw.media);
    const id = positiveInt(media?.id);
    const title = text(media?.title, 300);
    if (!media || !id || !title) return undefined;
    // Artwork is optional but, when present, must be an allowlisted AniList image.
    const coverUrl = media.coverUrl;
    if (
      coverUrl !== undefined &&
      (typeof coverUrl !== "string" || !isCacheableArtworkUrl(coverUrl))
    )
      return undefined;
    const bannerUrl =
      typeof media.bannerUrl === "string" && isCacheableArtworkUrl(media.bannerUrl)
        ? media.bannerUrl
        : undefined;
    const totalProgress = positiveInt(media.totalProgress, 100_000);
    const episode = raw.episode === undefined ? undefined : positiveInt(raw.episode, 100_000);
    if (raw.episode !== undefined && !episode) return undefined;
    return {
      kind: "anime",
      media: {
        id,
        title,
        ...(coverUrl ? { coverUrl } : {}),
        ...(bannerUrl ? { bannerUrl } : {}),
        ...(totalProgress ? { totalProgress } : {}),
      },
      ...(episode ? { episode } : {}),
    };
  }
  if (raw.kind === "more") {
    const source = record(raw.title);
    const id = positiveInt(source?.id);
    const type = source?.type === "MOVIE" || source?.type === "TV" ? source.type : undefined;
    const title = text(source?.title, 300);
    if (!source || !id || !type || !title) return undefined;
    const image = (url: unknown): string | undefined | null =>
      url === undefined ? undefined : typeof url === "string" && TMDB_IMAGE.test(url) ? url : null;
    const posterUrl = image(source.posterUrl);
    const backdropUrl = image(source.backdropUrl);
    if (posterUrl === null || backdropUrl === null) return undefined;
    const year = source.year === undefined ? undefined : positiveInt(source.year, 3000);
    const season = raw.season === undefined ? undefined : positiveInt(raw.season, 1000);
    const episode = raw.episode === undefined ? undefined : positiveInt(raw.episode, 100_000);
    if ((raw.season !== undefined && !season) || (raw.episode !== undefined && !episode))
      return undefined;
    // An episode target needs both parts and only exists for shows.
    if ((season || episode) && (type !== "TV" || !season || !episode)) return undefined;
    return {
      kind: "more",
      title: {
        id,
        type,
        title,
        ...(posterUrl ? { posterUrl } : {}),
        ...(backdropUrl ? { backdropUrl } : {}),
        ...(year ? { year } : {}),
      },
      ...(season && episode ? { season, episode } : {}),
    };
  }
  return undefined;
}

export function parseBingeName(value: unknown): string | undefined {
  return text(value, BINGE_NAME_MAX);
}

function parseListRef(value: unknown): BingeListRef | undefined {
  const raw = record(value);
  if (raw?.list === "queue") return { list: "queue" };
  const id = positiveInt(raw?.id);
  return raw?.list === "playlist" && id ? { list: "playlist", id } : undefined;
}

/** Validates one change from the renderer; undefined when anything is malformed. */
export function parseBingeChange(value: unknown): BingeChange | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  switch (raw.op) {
    case "add": {
      const target = parseListRef(raw.target);
      const item = parseBingeItem(raw.item);
      const position = raw.position === "next" || raw.position === "end" ? raw.position : undefined;
      return target && item && position ? { op: "add", target, item, position } : undefined;
    }
    case "remove": {
      const target = parseListRef(raw.target);
      const key = text(raw.key, 120);
      return target && key ? { op: "remove", target, key } : undefined;
    }
    case "move": {
      const target = parseListRef(raw.target);
      const key = text(raw.key, 120);
      const index =
        typeof raw.index === "number" && Number.isInteger(raw.index) && raw.index >= 0
          ? raw.index
          : undefined;
      return target && key && index !== undefined ? { op: "move", target, key, index } : undefined;
    }
    case "clear": {
      const target = parseListRef(raw.target);
      return target ? { op: "clear", target } : undefined;
    }
    case "create-playlist": {
      const name = parseBingeName(raw.name);
      return name && typeof raw.fromQueue === "boolean"
        ? { op: "create-playlist", name, fromQueue: raw.fromQueue }
        : undefined;
    }
    case "rename-playlist": {
      const id = positiveInt(raw.id);
      const name = parseBingeName(raw.name);
      return id && name ? { op: "rename-playlist", id, name } : undefined;
    }
    case "delete-playlist":
    case "queue-playlist": {
      const id = positiveInt(raw.id);
      return id ? { op: raw.op, id } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The item without artwork URLs: local backups deliberately carry no URLs or artwork, only the
 * exact IDs, titles, and targets needed to rebuild the lists.
 */
export function bingeItemWithoutArt(item: BingeItem): BingeItem {
  if (item.kind === "anime") {
    const { id, title, totalProgress } = item.media;
    return {
      kind: "anime",
      media: { id, title, ...(totalProgress ? { totalProgress } : {}) },
      ...(item.episode ? { episode: item.episode } : {}),
    };
  }
  const { id, type, title, year } = item.title;
  return {
    kind: "more",
    title: { id, type, title, ...(year ? { year } : {}) },
    ...(item.season && item.episode ? { season: item.season, episode: item.episode } : {}),
  };
}
