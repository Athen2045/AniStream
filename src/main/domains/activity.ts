import type { AniListClient } from "../anilist";
import type { AppDatabase } from "../database";
import { createActivityService } from "../activity/service";
import { reconcileActivity } from "../activity/reconcile";
import { registerTrustedIpcHandler } from "../ipc";

export function registerActivityDomain(
  origin: string,
  database: AppDatabase,
  aniList: AniListClient,
  onChanged: () => void,
): () => void {
  const owner = (): number | undefined => {
    const state = aniList.getState();
    return state.status === "signed-in" ? state.profile.id : undefined;
  };
  const service = createActivityService(
    database,
    {
      owner,
      reconcile: async (account, activity) => {
        await reconcileActivity(account, activity, {
          owner,
          read: async (id, type) => (await aniList.getMediaDetail(id, type, true)).listEntry,
          add: (id) => aniList.addEntry(id),
          update: (input) => aniList.updateEntry(input),
        });
        database.clearCachedAniListDashboard();
      },
    },
    onChanged,
  );
  registerTrustedIpcHandler(origin, "activity:record", (_event, input) => service.record(input));
  registerTrustedIpcHandler(origin, "activity:list", () => service.list());
  registerTrustedIpcHandler(origin, "activity:retry", () => service.retry());
  return service.dispose;
}
