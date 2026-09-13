import type { MangaDexReaderChapter, MangaReadingResume } from "./contracts";

export function buildLogicalChapterSequence(
  chapters: readonly MangaDexReaderChapter[],
  preferredGroupId?: string,
): MangaDexReaderChapter[] {
  const releasesByChapter = new Map<string, MangaDexReaderChapter[]>();
  for (const chapter of chapters) {
    const key = logicalChapterKey(chapter);
    const releases = releasesByChapter.get(key) ?? [];
    releases.push(chapter);
    releasesByChapter.set(key, releases);
  }

  return [...releasesByChapter.values()]
    .sort((left, right) => compareLogicalChapters(left[0], right[0]))
    .map((releases) => chooseRelease(releases, preferredGroupId));
}

export function selectAdjacentChapter(
  chapters: readonly MangaDexReaderChapter[],
  currentChapterId: string,
  direction: -1 | 1,
  preferredGroupId?: string,
): MangaDexReaderChapter | undefined {
  const current = chapters.find((chapter) => chapter.id === currentChapterId);
  if (!current) return undefined;
  const currentKey = logicalChapterKey(current);
  const sequence = buildLogicalChapterSequence(chapters, preferredGroupId);
  const currentIndex = sequence.findIndex((chapter) => logicalChapterKey(chapter) === currentKey);
  return currentIndex < 0 ? undefined : sequence[currentIndex + direction];
}

export function selectChapterToRead(
  chapters: readonly MangaDexReaderChapter[],
  trackerProgress: number,
  resume?: MangaReadingResume,
  preferredGroupId?: string,
): MangaDexReaderChapter | undefined {
  if (!chapters.length) return undefined;
  if (resume) {
    const exactRelease = chapters.find((chapter) => chapter.id === resume.chapterId);
    if (exactRelease) {
      return resume.progress >= 0.9
        ? selectAdjacentChapter(chapters, exactRelease.id, 1, preferredGroupId)
        : exactRelease;
    }
  }

  const sequence = buildLogicalChapterSequence(chapters, preferredGroupId);
  if (resume?.chapterNumber !== undefined && resume.progress < 0.9) {
    const resumedLogicalChapter = sequence.find(
      (chapter) => chapter.number === resume.chapterNumber,
    );
    if (resumedLogicalChapter) return resumedLogicalChapter;
  }
  const completedProgress = Math.max(
    trackerProgress,
    resume && resume.progress >= 0.9 ? (resume.chapterNumber ?? 0) : 0,
  );
  if (completedProgress > 0) {
    return sequence.find(
      (chapter) => chapter.number !== undefined && chapter.number > completedProgress,
    );
  }
  return sequence[0];
}

function chooseRelease(
  releases: readonly MangaDexReaderChapter[],
  preferredGroupId?: string,
): MangaDexReaderChapter {
  const sorted = [...releases].sort((left, right) => {
    const leftPreferred = preferredGroupId
      ? left.groups.some((group) => group.id === preferredGroupId)
      : false;
    const rightPreferred = preferredGroupId
      ? right.groups.some((group) => group.id === preferredGroupId)
      : false;
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    const published = (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
    return published || left.id.localeCompare(right.id);
  });
  return sorted[0];
}

function logicalChapterKey(chapter: MangaDexReaderChapter): string {
  if (chapter.number === undefined) return `release:${chapter.id}`;
  return `volume:${chapter.volume ?? ""}:chapter:${chapter.number}`;
}

function compareLogicalChapters(left: MangaDexReaderChapter, right: MangaDexReaderChapter): number {
  if (left.volume !== undefined && right.volume !== undefined && left.volume !== right.volume) {
    const volume = left.volume.localeCompare(right.volume, undefined, { numeric: true });
    if (volume) return volume;
  }
  if (left.number !== undefined && right.number !== undefined && left.number !== right.number) {
    return left.number - right.number;
  }
  if (left.number !== undefined) return -1;
  if (right.number !== undefined) return 1;
  return left.id.localeCompare(right.id);
}
