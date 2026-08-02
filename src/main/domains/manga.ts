import type { AniListClient } from "../anilist";
import type { MalClient } from "../mal";
import type { MangaDexClient } from "../mangadex";
import type { MangaTitleModule } from "../manga-title";
import {
  classifyLatestMangaUpdates,
  needsMalKindCrossCheck,
  type AniListMangaKindHint,
} from "../manga-kind";
import { registerTrustedIpcHandler } from "../ipc";
import type { MangaPublicationKind } from "../../shared/contracts";

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
  registerTrustedIpcHandler(trustedRendererOrigin, "request:cancel", (_event, requestId) => {
    titleRequests.get(requestId)?.abort();
    titleRequests.delete(requestId);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "mangadex:latest", async (_event, page) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    const updates = await mangaDex.getLatestUpdates(page);
    let aniListHints = new Map<number, AniListMangaKindHint>();
    if (aniList) {
      try {
        aniListHints = await aniList.getMangaKindHints(
          updates.items.flatMap((item) => (item.aniListId ? [item.aniListId] : [])),
        );
      } catch {
        // Classification enrichment is best-effort; MangaDex language remains usable.
      }
    }

    const malHints = new Map<number, MangaPublicationKind>();
    if (mal?.configured) {
      const malIds = [
        ...new Set(
          updates.items.flatMap((item) => {
            const aniListHint = item.aniListId ? aniListHints.get(item.aniListId) : undefined;
            const malId = item.malId ?? aniListHint?.malId;
            return malId && needsMalKindCrossCheck(item, aniListHint) ? [malId] : [];
          }),
        ),
      ].slice(0, 6);
      await Promise.all(
        malIds.map(async (malId) => {
          const kind = await mal?.getMangaPublicationKind(malId);
          if (kind) malHints.set(malId, kind);
        }),
      );
    }
    return {
      ...updates,
      items: classifyLatestMangaUpdates(updates.items, aniListHints, malHints),
    };
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
