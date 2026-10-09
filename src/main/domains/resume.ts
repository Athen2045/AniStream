import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";

export interface ResumeDomainDeps {
  database: AppDatabase | undefined;
}

/** Local SQLite resume state for anime playback and manga reading. */
export function registerResumeDomain(
  trustedRendererOrigin: string,
  { database }: ResumeDomainDeps,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "playback:resume", (_event, aniListId) => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database.getPlaybackResume(aniListId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "manga:reading-resume", (_event, aniListId) => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database.getMangaReadingResume(aniListId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:resume", (_event, input) => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database.getMorePlaybackResume(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:save-resume", (_event, input) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.saveMorePlaybackResume(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "more:clear-resume", (_event, input) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.clearMorePlaybackResume(input);
  });
}
