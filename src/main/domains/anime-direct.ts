import { randomUUID } from "node:crypto";
import type { AniListClient } from "../anilist";
import type { AnimeDirectSource, DirectStream } from "../anime-direct-source";
import type { AniZipClient } from "../anizip";
import { checkEpisodeRuntime, measureHlsSeconds } from "../episode-runtime-check";
import { createBoundedCache } from "../anilist/cache";
import { registerTrustedIpcHandler } from "../ipc";
import { readFile } from "node:fs/promises";
import type { StreamProxy } from "../stream-proxy";
import type { DownloadManager } from "../downloads/download-manager";
import { parseSubtitleText } from "../anime-direct-source";
import type { AnimeDirectPlayback } from "../../shared/contracts";

const UNMATCHED =
  "This title could not be matched exactly in the backup source, so it is not played from there.";

export interface ResolvedDirectEpisode {
  stream: DirectStream;
  /** AniList's episode length in minutes, when known. */
  minutes?: number;
}

/**
 * Finds one episode's stream in the direct source: exact AniList match first (format, start year,
 * episode count, first air date), then the episode page. Throws a user-facing message otherwise.
 * Shared by playback and offline downloads so both use the same identity rules.
 */
export async function resolveDirectEpisode(
  source: AnimeDirectSource,
  aniList: AniListClient,
  aniListId: number,
  episode: number,
): Promise<ResolvedDirectEpisode> {
  const detail = await aniList.getMediaDetail(aniListId, "ANIME");
  const aired = detail.nextAiringEpisode ? detail.nextAiringEpisode.episode - 1 : undefined;
  const slug = await source.match(aniListId, {
    titles: [detail.titleRomaji, detail.titleEnglish, detail.title].filter(
      (title): title is string => Boolean(title),
    ),
    format: detail.format,
    startDate: detail.startDate,
    episodes: detail.status === "RELEASING" ? aired : detail.totalProgress,
    airing: detail.status === "RELEASING",
  });
  if (!slug) throw new Error(UNMATCHED);
  const stream = await source.stream(slug, episode);
  if (!stream) throw new Error("The backup source has no stream for this episode.");
  return { stream, ...(detail.duration ? { minutes: detail.duration } : {}) };
}

/**
 * Own-player playback from the direct-stream source (trial 2026-10-18): matches the AniList entry
 * (search + format/year/episode-count/first-air-date), resolves the episode's HLS stream behind the
 * stream proxy, and serves subtitles as WebVTT by opaque ID.
 */
export function registerAnimeDirectDomain(
  trustedRendererOrigin: string,
  deps: {
    source: AnimeDirectSource | undefined;
    proxy: Pick<StreamProxy, "createUrl" | "offlineUrl">;
    /** Finished downloads play from disk first, with no network. */
    downloads?: () => DownloadManager | undefined;
    aniList: AniListClient | undefined;
    /** Per-episode runtimes for the mislabel check. */
    anizip?: AniZipClient;
  },
): void {
  const subtitleUrls = createBoundedCache<string>({ maxEntries: 400, ttlMs: 6 * 3_600_000 });
  // Subtitle IDs of downloaded episodes point at files on disk instead of URLs.
  const subtitleFiles = createBoundedCache<string>({ maxEntries: 400, ttlMs: 6 * 3_600_000 });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anime:direct-playback",
    async (_event, input): Promise<AnimeDirectPlayback> => {
      const downloads = deps.downloads?.();
      const offline = await downloads?.offlineEpisode(input.aniListId, input.episode);
      if (downloads && offline)
        return {
          status: "ready",
          offline: true,
          streamUrl: deps.proxy.offlineUrl(offline.id, offline.master),
          fonts: offline.fonts.map((font) => deps.proxy.offlineUrl(offline.id, font)),
          subtitles: offline.subtitles.flatMap((track) => {
            const file = downloads.filePath(offline.id, track.file);
            if (!file) return [];
            const id = randomUUID();
            subtitleFiles.set(id, file);
            return [{ id, label: track.label, language: track.language, default: track.default }];
          }),
        };
      const { source, aniList } = deps;
      if (!source || !aniList)
        return { status: "unavailable", message: "The backup source is not configured." };
      try {
        const detail = await aniList.getMediaDetail(input.aniListId, "ANIME");
        const { stream } = await resolveDirectEpisode(
          source,
          aniList,
          input.aniListId,
          input.episode,
        );
        // Mislabel check: the stream's real length against the expected runtime. Best effort: a
        // failed measurement never blocks playback.
        const [actualSeconds, episodeMinutes] = await Promise.all([
          measureHlsSeconds(stream.src, (url) => source.mediaText(url)).catch(() => undefined),
          deps.anizip
            ?.getTitle(input.aniListId)
            .then(
              (title) => title.index.find((row) => row.number === input.episode)?.runtimeMinutes,
            )
            .catch(() => undefined),
        ]);
        const runtime = checkEpisodeRuntime({
          actualSeconds,
          episodeMinutes,
          seriesMinutes: detail.duration,
        });
        return {
          status: "ready",
          ...(runtime ? { runtime } : {}),
          streamUrl: deps.proxy.createUrl(stream.src, source.mediaHeaders()),
          fonts: stream.fonts.map((font) => deps.proxy.createUrl(font, source.mediaHeaders())),
          subtitles: stream.subtitles.map((track) => {
            const id = randomUUID();
            subtitleUrls.set(id, track.url);
            return { id, label: track.label, language: track.language, default: track.default };
          }),
        };
      } catch (reason) {
        return {
          status: "unavailable",
          message: reason instanceof Error ? reason.message : "The backup source is unavailable.",
        };
      }
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anime:direct-subtitle", async (_event, id) => {
    const file = subtitleFiles.get(id);
    if (file) return parseSubtitleText(await readFile(file, "utf8"));
    const url = subtitleUrls.get(id);
    if (!url || !deps.source) throw new Error("This subtitle track has expired.");
    return deps.source.subtitle(url);
  });
}
