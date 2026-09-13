import type {
  AniListMedia,
  MangaReadingResume,
  PlaybackResume,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
} from "./contracts";
import { isValidMangaReadingResumeInput, isValidPlaybackResumeInput } from "./resume-validation";

export interface RecordActivityInput {
  media: AniListMedia;
  unit: number;
  state: "started" | "completed";
  chapterId?: string;
  checkpoint?: SavePlaybackResumeInput | SaveMangaReadingResumeInput;
}

export interface LocalActivity extends RecordActivityInput {
  completedProgress: number;
  updatedAt: string;
  syncStatus: "local" | "pending" | "synced";
  syncError?: string;
  playbackResume?: PlaybackResume;
  mangaResume?: MangaReadingResume;
}

/** Persist only a bounded display snapshot, never arbitrary renderer/provider data. */
export function normalizeActivityInput(value: unknown): RecordActivityInput {
  if (!value || typeof value !== "object") throw new Error("Invalid local activity.");
  const input = value as Record<string, unknown>;
  if (!input.media || typeof input.media !== "object") throw new Error("Invalid activity media.");
  const media = input.media as Record<string, unknown>;
  const text = (value: unknown, maximum: number): string => {
    if (typeof value !== "string" || value.length > maximum)
      throw new Error("Invalid activity text.");
    return value;
  };
  const url = (value: unknown): string => {
    const result = text(value, 2048);
    if (
      result &&
      (!result.startsWith("https://") || new URL(result).username || new URL(result).password)
    )
      throw new Error("Invalid activity URL.");
    return result;
  };
  if (
    !Number.isSafeInteger(media.id) ||
    Number(media.id) <= 0 ||
    (media.type !== "ANIME" && media.type !== "MANGA") ||
    typeof input.unit !== "number" ||
    !Number.isFinite(input.unit) ||
    input.unit < 0 ||
    input.unit > 1_000_000 ||
    (media.type === "ANIME" && (!Number.isInteger(input.unit) || input.unit < 1)) ||
    (input.state !== "started" && input.state !== "completed")
  )
    throw new Error("Invalid local activity.");
  const totalProgress =
    typeof media.totalProgress === "number" &&
    Number.isSafeInteger(media.totalProgress) &&
    media.totalProgress > 0
      ? media.totalProgress
      : undefined;
  let checkpoint: RecordActivityInput["checkpoint"];
  if (input.checkpoint !== undefined) {
    if (media.type === "ANIME" && isValidPlaybackResumeInput(input.checkpoint)) {
      if (input.checkpoint.aniListId !== media.id || input.checkpoint.episode !== input.unit)
        throw new Error("Checkpoint does not match activity.");
      checkpoint = input.checkpoint;
    } else if (media.type === "MANGA" && isValidMangaReadingResumeInput(input.checkpoint)) {
      if (
        input.checkpoint.aniListId !== media.id ||
        input.checkpoint.chapterId !== input.chapterId ||
        (input.checkpoint.chapterNumber ?? 0) !== input.unit
      )
        throw new Error("Checkpoint does not match activity.");
      checkpoint = input.checkpoint;
    } else throw new Error("Invalid activity checkpoint.");
  }
  return {
    media: {
      id: Number(media.id),
      type: media.type,
      title: text(media.title, 500),
      coverUrl: url(media.coverUrl),
      siteUrl: url(media.siteUrl),
      totalProgress,
    },
    unit: input.unit,
    state: input.state,
    chapterId: input.chapterId === undefined ? undefined : text(input.chapterId, 128),
    checkpoint,
  };
}
