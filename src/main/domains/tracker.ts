import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import type { AniListAuthState } from "../../shared/contracts";

export interface TrackerDomainDeps {
  aniList: AniListClient | undefined;
  database: AppDatabase | undefined;
  authRestored: Promise<AniListAuthState>;
}

/** AniList auth, profile, dashboard, and list-entry mutations. */
export function registerTrackerDomain(
  trustedRendererOrigin: string,
  { aniList, database, authRestored }: TrackerDomainDeps,
): void {
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:auth-state", async () => {
    await authRestored;
    return aniList?.getState() ?? { status: "signed-out" };
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:login", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.startLogin();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:cancel-login", () => {
    if (!aniList) throw new Error("AniList is not ready.");
    aniList.cancelLogin();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:logout", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.logout();
    database?.clearCachedAniListDashboard();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:cached-dashboard", () =>
    database?.getCachedAniListDashboard(),
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:dashboard", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    const dashboard = await aniList.getDashboard();
    database?.saveCachedAniListDashboard(dashboard);
    return dashboard;
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:search",
    async (_event, query, type) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.searchMedia(query, type);
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:browse", async (_event, input) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.browseMedia(input);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:media-detail",
    async (_event, id, type) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.getMediaDetail(id, type);
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:add-entry", async (_event, mediaId) => {
    if (!aniList) throw new Error("AniList is not ready.");
    const entry = await aniList.addEntry(mediaId);
    database?.clearCachedAniListDashboard();
    return entry;
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:update-entry",
    async (_event, input) => {
      if (!aniList) throw new Error("AniList is not ready.");
      const entry = await aniList.updateEntry(input);
      database?.clearCachedAniListDashboard();
      return entry;
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:delete-entry", async (_event, id) => {
    if (!aniList) throw new Error("AniList is not ready.");
    await aniList.deleteEntry(id);
    database?.clearCachedAniListDashboard();
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:latest-anime", async (_event, page) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getLatestAnimeUpdates(page);
  });
}
