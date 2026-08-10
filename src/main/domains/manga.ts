import type { AniListClient } from "../anilist";
import type { MalClient } from "../mal";
import type { MangaDexClient } from "../mangadex";
import type { MangaTitleModule } from "../manga-title";
import { MangaLatestModule } from "../manga-latest";
import { registerTrustedIpcHandler } from "../ipc";

export interface MangaDomainDeps {
  mangaDex: MangaDexClient | undefined;
  mangaTitle: MangaTitleModule | undefined;
  aniList: AniListClient | undefined;
  mal: MalClient | undefined;
}

/**
 * MangaDex latest/availability/reader/page delivery, plus MangaBaka exact-ID
 * enrichment bridged to MangaUpdates series/group metadata.
 */
export function registerMangaDomain(
  trustedRendererOrigin: string,
  { mangaDex, mangaTitle, aniList, mal }: MangaDomainDeps,
): void {
  const titleRequests = new Map<string, AbortController>();
  const mangaLatest = new MangaLatestModule({ mangaDex, aniList, mal });
  registerTrustedIpcHandler(trustedRendererOrigin, "request:cancel", (_event, requestId) => {
    titleRequests.get(requestId)?.abort();
    titleRequests.delete(requestId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "mangadex:latest", async (_event, page) => {
    return mangaLatest.load(page);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "mangadex:availability",
    async (_event, media) => {
      if (!mangaDex) throw new Error("MangaDex is not ready.");
      return mangaDex.getAvailability(media);
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:title-snapshot",
    async (_event, input, requestId) => {
      if (!mangaTitle) throw new Error("Manga title data is not ready.");
      titleRequests.get(requestId)?.abort();
      const controller = new AbortController();
      titleRequests.set(requestId, controller);
      try {
        return await mangaTitle.load(input, controller.signal);
      } finally {
        if (titleRequests.get(requestId) === controller) titleRequests.delete(requestId);
      }
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "mangadex:page", async (_event, input) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getPage(input);
  });
}
