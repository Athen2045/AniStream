import type {
  AniListMedia,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
} from "../../shared/contracts";

function changed(): void {
  window.dispatchEvent(new Event("anistream:activity-updated"));
}

export async function saveAnimeActivity(
  media: AniListMedia,
  input: SavePlaybackResumeInput,
): Promise<void> {
  await window.anistream.recordActivity({
    media,
    unit: input.episode,
    state: "started",
    checkpoint: input,
  });
  changed();
}

export async function saveMangaActivity(
  media: AniListMedia,
  input: SaveMangaReadingResumeInput,
): Promise<void> {
  await window.anistream.recordActivity({
    media,
    unit: input.chapterNumber ?? 0,
    chapterId: input.chapterId,
    state: "started",
    checkpoint: input,
  });
  changed();
}
