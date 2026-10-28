import { readFile } from "node:fs/promises";
import { episodeArtSourceFromCacheUrl } from "../../shared/artwork";
import type { AnimeSkipSegment, AnimeSkipTimesInput } from "../../shared/contracts";
import type { AnimeDownload } from "../../shared/downloads";
import type { TitleCopies } from "../title-copies";

/**
 * What a downloaded episode needs offline besides its video (user report 2026-10-28), saved while
 * online: its episode still (the title page's preview) and its AniSkip opening/ending times. Both
 * were only saved when shown or played online, so an episode downloaded and never watched had a
 * blank preview and no Skip buttons offline.
 */
export interface DownloadExtrasDeps {
  downloads: () => readonly AnimeDownload[];
  copies: TitleCopies;
  /** The episode-art cache: fetches and keeps an allowlisted still. */
  stills: { get(url: string): Promise<unknown> };
  skipTimes?: { getSkipTimes(input: AnimeSkipTimesInput): Promise<AnimeSkipSegment[]> };
  /** The downloaded video playlist of an episode, for its length. */
  readPlaylist?: (item: AnimeDownload) => Promise<string>;
}

/** The saved skip-times copy for one cut of an episode (shared with the `anime:skip-times` IPC). */
export function skipTimesCopyKey(
  aniListId: number,
  episode: number,
  durationSeconds: number,
): string {
  return `skip:${aniListId}:${episode}:${Math.round(durationSeconds)}`;
}

/** Stills of every title with downloads, never evicted from the episode-art cache. */
export function keptStillSources(copies: TitleCopies): string[] {
  return copies.pinned("art:").flatMap(({ value }) => stillRows(value).map((row) => row.source));
}

/** The length of a downloaded episode from its playlist (the sum of its segments). */
export function playlistSeconds(playlist: string): number {
  let total = 0;
  for (const match of playlist.matchAll(/^#EXTINF:([\d.]+)/gm)) total += Number(match[1]);
  return total;
}

export function createDownloadExtras(deps: DownloadExtrasDeps): { save(): void } {
  // Per session: a still or skip lookup that is running or done; failures are tried again later.
  const started = new Set<string>();
  const attempt = (key: string, run: () => Promise<boolean>): void => {
    if (started.has(key)) return;
    started.add(key);
    void run().then(
      (done) => {
        if (!done) started.delete(key);
      },
      () => started.delete(key),
    );
  };

  const saveStill = (item: AnimeDownload): void => {
    const source = deps.copies
      .pinned(`art:${item.aniListId}:`)
      .flatMap(({ value }) => stillRows(value))
      .find((row) => row.number === item.episode)?.source;
    if (source) attempt(`still:${source}`, async () => Boolean(await deps.stills.get(source)));
  };

  const saveSkipTimes = (item: AnimeDownload): void => {
    const { skipTimes, readPlaylist } = deps;
    if (!skipTimes || !readPlaylist || item.status !== "done") return;
    attempt(`skip:${item.id}`, async () => {
      const malId = malIdOf(deps.copies.read(`detail:ANIME:${item.aniListId}`));
      if (!malId) return false;
      const durationSeconds = playlistSeconds(await readPlaylist(item));
      if (durationSeconds <= 0) return true;
      const key = skipTimesCopyKey(item.aniListId, item.episode, durationSeconds);
      if (deps.copies.read(key) !== undefined) return true;
      const segments = await skipTimes.getSkipTimes({
        aniListId: item.aniListId,
        malId,
        episode: item.episode,
        durationSeconds,
      });
      deps.copies.write(key, item.aniListId, segments);
      return true;
    });
  };

  return {
    save() {
      for (const item of deps.downloads()) {
        saveStill(item);
        saveSkipTimes(item);
      }
    },
  };
}

/** Reads a downloaded episode's video playlist (`video/index.m3u8` in its folder). */
export function readDownloadPlaylist(
  filePath: (id: string, relative: string) => string | undefined,
): (item: AnimeDownload) => Promise<string> {
  return async (item) => {
    const file = filePath(item.id, "video/index.m3u8");
    if (!file) throw new Error("The download has no video playlist.");
    return readFile(file, "utf8");
  };
}

function stillRows(value: unknown): { number: number; source: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    const record = row as { number?: unknown; stillUrl?: unknown } | null;
    const source =
      typeof record?.stillUrl === "string"
        ? episodeArtSourceFromCacheUrl(record.stillUrl)
        : undefined;
    return typeof record?.number === "number" && source ? [{ number: record.number, source }] : [];
  });
}

function malIdOf(detail: unknown): number | undefined {
  const malId = (detail as { malId?: unknown } | null)?.malId;
  return typeof malId === "number" && Number.isInteger(malId) && malId > 0 ? malId : undefined;
}
