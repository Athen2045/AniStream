import type { AniListClient } from "./anilist";
import type { MalClient } from "./mal";
import type { MangaDexClient } from "./mangadex";
import {
  classifyLatestMangaUpdates,
  needsMalKindCrossCheck,
  type AniListMangaKindHint,
} from "./manga-kind";
import type {
  LatestMangaUpdate,
  LatestUpdatesPage,
  MangaPublicationKind,
} from "../shared/contracts";

export interface MangaLatestDeps {
  mangaDex: Pick<MangaDexClient, "getLatestUpdates"> | undefined;
  aniList: Pick<AniListClient, "getMangaKindHints"> | undefined;
  mal: Pick<MalClient, "configured" | "getMangaPublicationKind"> | undefined;
}

/**
 * Owns the cross-provider policy for the Latest Manga field. IPC only adapts
 * renderer requests to this module; provider quirks stay behind its adapters.
 */
export class MangaLatestModule {
  public constructor(private readonly deps: MangaLatestDeps) {}

  public async load(page: number): Promise<LatestUpdatesPage<LatestMangaUpdate>> {
    if (!this.deps.mangaDex) throw new Error("MangaDex is not ready.");

    const updates = await this.deps.mangaDex.getLatestUpdates(page);
    let aniListHints = new Map<number, AniListMangaKindHint>();
    if (this.deps.aniList) {
      try {
        aniListHints = await this.deps.aniList.getMangaKindHints(
          updates.items.flatMap((item) => (item.aniListId ? [item.aniListId] : [])),
        );
      } catch {
        // MangaDex language remains usable when AniList enrichment is unavailable.
      }
    }

    const malHints = new Map<number, MangaPublicationKind>();
    if (this.deps.mal?.configured) {
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
          try {
            const kind = await this.deps.mal?.getMangaPublicationKind(malId);
            if (kind) malHints.set(malId, kind);
          } catch {
            // A single MAL failure must not discard the MangaDex page.
          }
        }),
      );
    }

    return {
      ...updates,
      items: classifyLatestMangaUpdates(updates.items, aniListHints, malHints),
    };
  }
}
