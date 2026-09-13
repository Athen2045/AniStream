import type { LocalActivity, RecordActivityInput } from "../../shared/activity";
import type { AppDatabase } from "../database";

export interface ActivityTracker {
  owner(): number | undefined;
  reconcile(owner: number, activity: LocalActivity): Promise<void>;
}

export function createActivityService(
  database: AppDatabase,
  tracker: ActivityTracker,
  onChanged: () => void = () => undefined,
) {
  let running: Promise<void> | undefined;
  let disposed = false;
  const list = (): LocalActivity[] =>
    database.listActivity(tracker.owner()).map((item) => ({
      ...item,
      playbackResume:
        item.media.type === "ANIME" ? database.getPlaybackResume(item.media.id) : undefined,
      mangaResume:
        item.media.type === "MANGA" ? database.getMangaReadingResume(item.media.id) : undefined,
    }));
  const reconcile = (): Promise<void> => {
    if (running) return running;
    if (disposed) return Promise.resolve();
    const owner = tracker.owner();
    if (!owner) return Promise.resolve();
    running = (async () => {
      for (const item of database.pendingActivity(owner)) {
        if (disposed || tracker.owner() !== owner) break;
        try {
          await tracker.reconcile(owner, item);
          if (disposed) break;
          database.acknowledgeActivity(owner, item.media.id, item.completedProgress);
        } catch (reason) {
          if (disposed) break;
          database.acknowledgeActivity(
            owner,
            item.media.id,
            item.completedProgress,
            reason instanceof Error ? reason.message : "AniList sync failed.",
          );
          break;
        }
      }
    })().finally(() => {
      running = undefined;
      if (!disposed) onChanged();
    });
    return running;
  };
  return {
    list,
    async record(input: RecordActivityInput): Promise<LocalActivity> {
      if (disposed) throw new Error("Activity service is closed.");
      const owner = tracker.owner();
      const saved = database.recordActivity(input, owner);
      if (input.state === "completed") void reconcile().catch(() => undefined);
      return saved;
    },
    async retry(): Promise<LocalActivity[]> {
      await reconcile();
      return disposed ? [] : list();
    },
    dispose(): void {
      disposed = true;
    },
  };
}
