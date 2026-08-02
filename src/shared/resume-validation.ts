import type { SaveMangaReadingResumeInput, SavePlaybackResumeInput } from "./contracts";

export function isValidPlaybackResumeInput(input: SavePlaybackResumeInput): boolean {
  return (
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

export function isValidMangaReadingResumeInput(input: SaveMangaReadingResumeInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    /^[A-Za-z0-9_-]{1,160}$/.test(input.chapterId) &&
    (input.chapterNumber === undefined ||
      (Number.isFinite(input.chapterNumber) && input.chapterNumber >= 0)) &&
    Number.isFinite(input.progress) &&
    input.progress >= 0 &&
    input.progress <= 1
  );
}
