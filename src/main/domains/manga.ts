import type { AniListClient } from "../anilist";
import type { MalClient } from "../mal";
import type { MangaBakaClient } from "../mangabaka";
import type { MangaDexClient } from "../mangadex";
import type { MangaUpdatesClient } from "../mangaupdates";
import {
  classifyLatestMangaUpdates,
  needsMalKindCrossCheck,
  type AniListMangaKindHint,
} from "../manga-kind";
import { registerTrustedIpcHandler } from "../ipc";
import type { MangaPublicationKind } from "../../shared/contracts";

export interface MangaDomainDeps {
  mangaDex: MangaDexClient | undefined;
  mangaBaka: MangaBakaClient | undefined;
  mangaUpdates: MangaUpdatesClient | undefined;
  aniList: AniListClient | undefined;
  mal: MalClient | undefined;
}

/**
 * MangaDex latest/availability/reader/page delivery, plus MangaBaka exact-ID
 * enrichment bridged to MangaUpdates series/group metadata.
 */
export function registerMangaDomain(
  trustedRendererOrigin: string,
  { mangaDex, mangaBaka, mangaUpdates, aniList, mal }: MangaDomainDeps,
): void {
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
  registerTrustedIpcHandler(trustedRendererOrigin, "mangadex:reader", async (_event, input) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getReader(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "mangadex:page", async (_event, input) => {
    if (!mangaDex) throw new Error("MangaDex is not ready.");
    return mangaDex.getPage(input);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:enrichment",
    async (_event, aniListId) => {
      if (!mangaBaka) throw new Error("MangaBaka is not ready.");
      const enrichment = await mangaBaka.getEnrichment(aniListId);
      if (enrichment.status !== "available" || !enrichment.mangaUpdatesId || !mangaUpdates) {
        return enrichment;
      }
      const seriesId = Number(enrichment.mangaUpdatesId);
      if (!Number.isInteger(seriesId) || seriesId <= 0) return enrichment;
      try {
        const [series, groups] = await Promise.all([
          mangaUpdates.getSeries(seriesId),
          mangaUpdates.getGroups(seriesId),
        ]);
        return {
          ...enrichment,
          mangaUpdates: { ...series, groups },
        };
      } catch {
        return enrichment;
      }
    },
  );
}
