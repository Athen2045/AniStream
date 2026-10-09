import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { registerTrustedIpcHandler } from "../ipc";
import { AniListUnavailableError, asUnavailable, isAniListUnavailable } from "../anilist/errors";
import { applyEntryChanges, findEntry, summarize, type PendingEntryChange } from "../entry-changes";
import type { AniListDashboard } from "../../shared/contracts";

export interface TrackerDomainDeps {
  aniList: AniListClient | undefined;
  database: AppDatabase | undefined;
  /** Tells the renderer that queued library edits changed (sent or added). */
  onChanged?: () => void;
}

/** AniList auth, profile, dashboard, and list-entry mutations. */
export function registerTrackerDomain(
  trustedRendererOrigin: string,
  { aniList, database, onChanged = () => undefined }: TrackerDomainDeps,
): void {
  const owner = (): number | undefined => {
    const state = aniList?.getState();
    return state?.status === "signed-in" ? state.profile.id : undefined;
  };
  // Keeps the offline library copy in step with an edit instead of discarding it.
  const updateCachedDashboard = (change: (dashboard: AniListDashboard) => AniListDashboard) => {
    const cached = database?.getCachedAniListDashboard();
    if (!cached || cached.profile.id !== owner()) return undefined;
    const next = change(cached);
    try {
      database?.saveCachedAniListDashboard(next);
    } catch (error) {
      console.warn("AniStream could not update the offline AniList library copy.", error);
    }
    return next;
  };
  const queueChange = (change: PendingEntryChange): AniListDashboard | undefined => {
    const account = owner();
    if (!account || !database) throw new Error("Connect your AniList account first.");
    database.queueEntryChange(account, change);
    onChanged();
    return updateCachedDashboard((dashboard) => applyEntryChanges(dashboard, [change]));
  };
  /**
   * Sends queued edits in order. Stops at the first sign AniList is still unreachable; an edit
   * AniList rejects outright (for example an entry deleted elsewhere) is dropped, since resending
   * it can never succeed.
   */
  let flushing: Promise<void> | undefined;
  const flushQueuedChanges = (): Promise<void> => {
    flushing ??= (async () => {
      const account = owner();
      if (!aniList || !database || !account) return;
      let changed = false;
      for (const change of database.pendingEntryChanges(account)) {
        try {
          if (change.kind === "delete") await aniList.deleteEntry(change.entryId);
          else await aniList.updateEntry(change.input);
        } catch (error) {
          if (isAniListUnavailable(asUnavailable(error))) break;
          console.warn("AniList rejected a queued library edit; it was dropped.", error);
        }
        database.clearEntryChange(account, change.entryId);
        changed = true;
      }
      if (changed) onChanged();
    })().finally(() => {
      flushing = undefined;
    });
    return flushing;
  };
  /** Earlier edits still waiting means AniList is likely down; keep the new edit in order. */
  const hasQueuedChanges = (): boolean => {
    const account = owner();
    return Boolean(account && database?.pendingEntryChanges(account).length);
  };
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:auth-state", async () => {
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
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:pending-changes", () => {
    const account = owner();
    return account && database ? database.pendingEntryChanges(account).length : 0;
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:dashboard", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    await flushQueuedChanges();
    const account = owner();
    // Edits still waiting (AniList went away mid-flush) stay visible on top of the fresh library.
    const dashboard = applyEntryChanges(
      await aniList.getDashboard(),
      account && database ? database.pendingEntryChanges(account) : [],
    );
    try {
      database?.saveCachedAniListDashboard(dashboard);
    } catch (error) {
      // The offline copy is a convenience; it must never block the live library.
      console.warn("AniStream could not save the offline AniList library copy.", error);
    }
    return dashboard;
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:browse", async (_event, input) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.browseMedia(input);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:media-by-ids",
    async (_event, ids, type) => {
      if (!aniList) throw new Error("AniList is not ready.");
      return aniList.getMediaByIds(ids, type);
    },
  );
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
    // The offline copy keeps its last state; the next refresh adds the new entry.
    return aniList.addEntry(mediaId);
  });
  registerTrustedIpcHandler(
    trustedRendererOrigin,
    "anilist:update-entry",
    async (_event, input) => {
      if (!aniList) throw new Error("AniList is not ready.");
      try {
        await flushQueuedChanges();
        if (hasQueuedChanges()) throw new AniListUnavailableError();
        const entry = await aniList.updateEntry(input);
        updateCachedDashboard((dashboard) =>
          applyEntryChanges(dashboard, [
            { kind: "update", entryId: input.id, input, queuedAt: new Date().toISOString() },
          ]),
        );
        return entry;
      } catch (error) {
        if (!isAniListUnavailable(asUnavailable(error))) throw error;
        const dashboard = queueChange({
          kind: "update",
          entryId: input.id,
          input,
          queuedAt: new Date().toISOString(),
        });
        const entry = dashboard ? findEntry(dashboard, input.id) : undefined;
        return {
          ...(entry
            ? summarize(entry)
            : {
                id: input.id,
                status: input.status ?? "CURRENT",
                score: input.score ?? 0,
                progress: input.progress ?? 0,
              }),
          queued: true,
        };
      }
    },
  );
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:delete-entry", async (_event, id) => {
    if (!aniList) throw new Error("AniList is not ready.");
    const change: PendingEntryChange = {
      kind: "delete",
      entryId: id,
      queuedAt: new Date().toISOString(),
    };
    try {
      await flushQueuedChanges();
      if (hasQueuedChanges()) throw new AniListUnavailableError();
      await aniList.deleteEntry(id);
      updateCachedDashboard((dashboard) => applyEntryChanges(dashboard, [change]));
      return { queued: false };
    } catch (error) {
      if (!isAniListUnavailable(asUnavailable(error))) throw error;
      queueChange(change);
      return { queued: true };
    }
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:latest-anime", async (_event, page) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getLatestAnimeUpdates(page);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:schedule", async (_event, input) => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getAiringSchedule(input);
  });
  registerTrustedIpcHandler(trustedRendererOrigin, "anilist:filter-options", async () => {
    if (!aniList) throw new Error("AniList is not ready.");
    return aniList.getFilterOptions();
  });
}
