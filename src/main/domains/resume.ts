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
  registerTrustedIpcHandler(trustedRendererOrigin, "playback:save-resume", (_event, input) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.savePlaybackResume(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "playback:clear-resume", (_event, aniListId) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.clearPlaybackResume(aniListId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "manga:reading-resume", (_event, aniListId) => {
    if (!database) throw new Error("AniStream database is not ready.");
    return database.getMangaReadingResume(aniListId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "manga:save-reading-resume", (_event, input) => {
    if (!database) throw new Error("AniStream database is not ready.");
    database.saveMangaReadingResume(input);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:clear-reading-resume",
    (_event, aniListId) => {
      if (!database) throw new Error("AniStream database is not ready.");
      database.clearMangaReadingResume(aniListId);
    },
  );
}
