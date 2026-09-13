import type { SaveMangaReadingResumeInput, SavePlaybackResumeInput } from "./contracts";

export function isValidPlaybackResumeInput(value: unknown): value is SavePlaybackResumeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.aniListId === "number" &&
    typeof input.episode === "number" &&
    typeof input.positionSeconds === "number" &&
    typeof input.durationSeconds === "number" &&
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    Number.isInteger(input.episode) &&
    input.episode > 0 &&
    Number.isFinite(input.positionSeconds) &&
    input.positionSeconds >= 0 &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds >= 0 &&
    input.positionSeconds <= Math.max(input.durationSeconds + 30, 30)
  );
}

export function isValidMangaReadingResumeInput(
  value: unknown,
): value is SaveMangaReadingResumeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.aniListId === "number" &&
    typeof input.chapterId === "string" &&
    typeof input.progress === "number" &&
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    /^[A-Za-z0-9_-]{1,160}$/.test(input.chapterId) &&
    (input.chapterNumber === undefined ||
      (typeof input.chapterNumber === "number" &&
        Number.isFinite(input.chapterNumber) &&
        input.chapterNumber >= 0)) &&
    Number.isFinite(input.progress) &&
    input.progress >= 0 &&
    input.progress <= 1
  );
}
