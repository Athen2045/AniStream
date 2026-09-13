import type { AniListClient } from "../anilist";
import type { MalClient } from "../mal";
import type { MangaDexClient } from "../mangadex";
import type { MangaTitleModule } from "../manga-title";
import { MangaLatestModule } from "../manga-latest";
import { registerTrustedIpcHandler } from "../ipc";
import type { MangaPreferenceRepository } from "../manga-preferences";
import type { ReaderSettingsRepository } from "../reader-settings";

export interface MangaDomainDeps {
  mangaDex: MangaDexClient | undefined;
  mangaTitle: MangaTitleModule | undefined;
  aniList: AniListClient | undefined;
  mal: MalClient | undefined;
  preferences?: MangaPreferenceRepository;
  readerSettings?: ReaderSettingsRepository;
}

/**
 * MangaDex latest/availability/reader/page delivery, plus MangaBaka exact-ID
 * enrichment bridged to MangaUpdates series/group metadata.
 */
export function registerMangaDomain(
  trustedRendererOrigin: string,
  { mangaDex, mangaTitle, aniList, mal, preferences, readerSettings }: MangaDomainDeps,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "reader:settings", () => {
    if (!readerSettings) throw new Error("Reader settings are not ready.");
    return readerSettings.getReaderSettings();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "reader:save-settings", (_event, input) => {
    if (!readerSettings) throw new Error("Reader settings are not ready.");
    return readerSettings.saveReaderSettings(input);
  });
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
      return mangaDex.getAvailability(
        media.map((item) => ({
          ...item,
          translatedLanguage:
            item.translatedLanguage ??
            preferences?.getMangaReaderPreferences(item.aniListId)?.translatedLanguage,
        })),
      );
    },
  );
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "manga:save-reader-preferences",
    (_event, input) => {
      if (!preferences) throw new Error("Manga reader preferences are not ready.");
      return preferences.saveMangaReaderPreferences(input);
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
