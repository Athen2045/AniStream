import type { AniListCatalogMedia, AniStreamBridge, MoreCatalogItem } from "../../shared/contracts";
import {
  bingeItemKey,
  type BingeChange,
  type BingeEntry,
  type BingeItem,
  type BingeState,
} from "../../shared/binge";

type Bridge = Pick<AniStreamBridge, "getBingeState" | "applyBingeChange">;

export interface BingeSnapshot extends BingeState {
  loaded: boolean;
  error?: string;
}

const AUTOPLAY_KEY = "anistream.autoplay";

/** Autoplay is on unless this device turned it off (user decision 2026-10-06: on by default). */
export function readAutoplay(): boolean {
  try {
    return window.localStorage.getItem(AUTOPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoplay(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTOPLAY_KEY, enabled ? "on" : "off");
  } catch {
    // A per-device convenience; the default applies without storage.
  }
}

/**
 * Renderer view of Up Next and playlists. The main process owns the lists; every change goes
 * through one validated IPC call and the returned state replaces the local copy.
 */
export function createBingeSession(bridge: Bridge) {
  let snapshot: BingeSnapshot = { queue: [], playlists: [], loaded: false };
  const listeners = new Set<() => void>();
  let revision = 0;

  function publish(next: BingeSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function load(): Promise<void> {
    const expected = ++revision;
    try {
      const state = await bridge.getBingeState();
      if (expected === revision) publish({ ...state, loaded: true });
    } catch {
      if (expected === revision)
        publish({ ...snapshot, loaded: true, error: "Up Next could not be loaded." });
    }
  }

  async function apply(change: BingeChange): Promise<boolean> {
    const expected = ++revision;
    try {
      const state = await bridge.applyBingeChange(change);
      if (expected === revision) publish({ ...state, loaded: true });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      // Limits are worded for people in the main process; anything else stays generic.
      const friendly = /holds up to|up to \d+ playlists|no longer exists/.test(message)
        ? message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
        : "That change could not be saved. Try again.";
      if (expected === revision) publish({ ...snapshot, error: friendly });
      return false;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    apply,
    dismissError() {
      if (snapshot.error) publish({ ...snapshot, error: undefined });
    },
    /** Takes the first Up Next entry off the queue and returns it (undefined when empty). */
    async takeNext(): Promise<BingeEntry | undefined> {
      const next = snapshot.queue[0];
      if (!next) return undefined;
      await apply({ op: "remove", target: { list: "queue" }, key: next.key });
      return next;
    },
    isQueued(item: BingeItem): boolean {
      const key = bingeItemKey(item);
      return snapshot.queue.some((entry) => entry.key === key);
    },
  };
}

export type BingeSession = ReturnType<typeof createBingeSession>;

/** A queueable anime: continue the show, or a specific episode. */
export function animeBingeItem(media: AniListCatalogMedia, episode?: number): BingeItem {
  return {
    kind: "anime",
    media: {
      id: media.id,
      title: media.title,
      coverUrl: media.coverUrl,
      ...(media.bannerUrl ? { bannerUrl: media.bannerUrl } : {}),
      ...(media.totalProgress ? { totalProgress: media.totalProgress } : {}),
    },
    ...(episode ? { episode } : {}),
  };
}

/** A queueable movie or show (optionally one episode of a show). */
export function moreBingeItem(item: MoreCatalogItem, season?: number, episode?: number): BingeItem {
  return {
    kind: "more",
    title: {
      id: item.id,
      type: item.type,
      title: item.title,
      ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
      ...(item.backdropUrl ? { backdropUrl: item.backdropUrl } : {}),
      ...(item.year ? { year: item.year } : {}),
    },
    ...(item.type === "TV" && season && episode ? { season, episode } : {}),
  };
}

/** The catalog shape the title pages open with; details load from the exact ID. */
export function bingeAnimeMedia(item: Extract<BingeItem, { kind: "anime" }>): AniListCatalogMedia {
  return {
    id: item.media.id,
    type: "ANIME",
    title: item.media.title,
    // A restored item has no artwork yet; the title page loads it from the exact ID.
    coverUrl: item.media.coverUrl ?? "",
    ...(item.media.bannerUrl ? { bannerUrl: item.media.bannerUrl } : {}),
    ...(item.media.totalProgress ? { totalProgress: item.media.totalProgress } : {}),
    genres: [],
    siteUrl: `https://anilist.co/anime/${item.media.id}`,
  };
}

export function bingeMoreItem(item: Extract<BingeItem, { kind: "more" }>): MoreCatalogItem {
  return {
    id: item.title.id,
    type: item.title.type,
    title: item.title.title,
    ...(item.title.posterUrl ? { posterUrl: item.title.posterUrl } : {}),
    ...(item.title.backdropUrl ? { backdropUrl: item.title.backdropUrl } : {}),
    ...(item.title.year ? { year: item.title.year } : {}),
    genres: [],
    siteUrl: `https://www.themoviedb.org/${item.title.type === "MOVIE" ? "movie" : "tv"}/${item.title.id}`,
  };
}

/** Cover art for any item: AniList cover, else the TMDB poster or backdrop. */
export function bingeItemArt(item: BingeItem): string | undefined {
  return item.kind === "anime"
    ? item.media.coverUrl
    : (item.title.posterUrl ?? item.title.backdropUrl);
}

export function bingeItemTitle(item: BingeItem): string {
  return item.kind === "anime" ? item.media.title : item.title.title;
}
