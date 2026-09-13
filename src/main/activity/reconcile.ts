import type { LocalActivity } from "../../shared/activity";
import type {
  AniListListEntrySummary,
  AniListMediaType,
  UpdateAniListEntryInput,
} from "../../shared/contracts";

export async function reconcileActivity(
  owner: number,
  activity: LocalActivity,
  tracker: {
    owner(): number | undefined;
    read(id: number, type: AniListMediaType): Promise<AniListListEntrySummary | undefined>;
    add(id: number): Promise<AniListListEntrySummary>;
    update(input: UpdateAniListEntryInput): Promise<unknown>;
  },
): Promise<void> {
  const checkOwner = (): void => {
    if (tracker.owner() !== owner)
      throw new Error("AniList account changed; progress is saved for the original account.");
  };
  checkOwner();
  let entry = await tracker.read(activity.media.id, activity.media.type);
  checkOwner();
  if (!entry) {
    entry = await tracker.add(activity.media.id);
    checkOwner();
  }
  if (entry.progress >= activity.completedProgress) return;
  await tracker.update({
    id: entry.id,
    progress: activity.completedProgress,
    status:
      entry.status === "COMPLETED" ||
      (activity.media.totalProgress && activity.completedProgress >= activity.media.totalProgress)
        ? "COMPLETED"
        : "CURRENT",
  });
}
