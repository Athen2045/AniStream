import type {
  AniListCatalogMedia,
  AniListEntry,
  AniListMediaType,
  MangaDexChapterAvailability,
} from "./contracts";
import type { LocalActivity } from "./activity";

export interface PersonalAiringUpdate {
  aniListId: number;
  episode: number;
  airedAt: number;
}
export interface PersonalTitle {
  media: AniListCatalogMedia;
  progress: number;
  updatedAt: number;
  entry?: AniListEntry;
  local?: LocalActivity;
}
export interface ContinueTitle extends PersonalTitle {
  label: string;
  targetUnit: number;
}
/** An aired episode or new chapter past the user's progress; it clears once they catch up. */
export interface PersonalRelease {
  key: string;
  unit: number;
  media: AniListCatalogMedia;
  kind: "aired" | "translated";
  language?: string;
  timestamp: number;
}

export function buildPersonalTitles(
  type: AniListMediaType,
  entries: AniListEntry[],
  activity: LocalActivity[],
  /** When the AniList lists were fetched (epoch ms); absent for guests. */
  listsFetchedAt?: number,
): PersonalTitle[] {
  const titles = new Map<number, PersonalTitle>();
  for (const entry of entries) {
    if (entry.media.type !== type || !["CURRENT", "REPEATING", "COMPLETED"].includes(entry.status))
      continue;
    const previous = titles.get(entry.media.id);
    if (previous && previous.updatedAt >= entry.updatedAt * 1000) continue;
    titles.set(entry.media.id, {
      media: { ...entry.media, genres: entry.media.genres ?? [] },
      progress: entry.progress,
      updatedAt: entry.updatedAt * 1000,
      entry,
    });
  }
  for (const local of activity) {
    if (local.media.type !== type) continue;
    const previous = titles.get(local.media.id);
    if (previous?.local && Date.parse(previous.local.updatedAt) >= Date.parse(local.updatedAt))
      continue;
    // Progress already sent to AniList, then removed there (or moved off Watching/Completed),
    // stays off: AniList's newer list is the answer, so a stray test play cannot linger.
    if (
      listsFetchedAt !== undefined &&
      local.syncStatus === "synced" &&
      !previous?.entry &&
      Date.parse(local.updatedAt) < listsFetchedAt
    )
      continue;
    titles.set(local.media.id, {
      ...previous,
      media: previous?.media ?? { ...local.media, genres: local.media.genres ?? [] },
      progress: Math.max(
        previous?.progress ?? 0,
        local.completedProgress,
        local.state === "completed" ? local.unit : 0,
      ),
      updatedAt: Math.max(previous?.updatedAt ?? 0, Date.parse(local.updatedAt) || 0),
      local,
    });
  }
  // Titles that can still be continued take the 24 slots first; finished ones only fill what is
  // left (they stay for release checks but never reach Continue), so an older in-progress title is
  // not pushed out by recently completed ones.
  return [...titles.values()]
    .sort((a, b) => Number(isFinished(a)) - Number(isFinished(b)) || b.updatedAt - a.updatedAt)
    .slice(0, PERSONAL_TITLE_LIMIT);
}

export const PERSONAL_TITLE_LIMIT = 24;

/** Mirrors `continueTitles`: finished unless a local checkpoint is resuming (e.g. a rewatch). */
function isFinished(title: PersonalTitle): boolean {
  const { media, progress, entry } = title;
  if (resumesLocally(title)) return false;
  return (
    entry?.status === "COMPLETED" || Boolean(media.totalProgress && progress >= media.totalProgress)
  );
}

/**
 * Whether a started local checkpoint drives Continue: always for guests, when it is ahead of the
 * tracker, and for AniList rewatches. A completed entry counts as a rewatch only when the
 * checkpoint is newer than the completion; an older one is a leftover from the first watch.
 */
function resumesLocally({ local, progress, entry }: PersonalTitle): boolean {
  if (local?.state !== "started") return false;
  if (!entry || local.unit > progress || entry.status === "REPEATING") return true;
  return entry.status === "COMPLETED" && Date.parse(local.updatedAt) > entry.updatedAt * 1000;
}

export function continueTitles(
  titles: PersonalTitle[],
  availability: Map<number, MangaDexChapterAvailability>,
  now = Date.now(),
): ContinueTitle[] {
  return titles.flatMap((title) => {
    const { media, local, progress, entry } = title;
    const unit = media.type === "ANIME" ? "episode" : "chapter";
    // Guests and explicit AniList rewatches keep their local unit. For a normal CURRENT entry,
    // an older checkpoint must never move the tracker-backed Continue target backwards.
    if (local?.state === "started" && resumesLocally(title)) {
      const resume = media.type === "ANIME" ? local.playbackResume : local.mangaResume;
      return [
        {
          ...title,
          label: `${resume ? "Resume" : "Continue"} ${unit} ${local.unit}`,
          targetUnit: local.unit,
        },
      ];
    }
    if (entry?.status === "COMPLETED" || (media.totalProgress && progress >= media.totalProgress))
      return [];
    const next = media.nextAiringEpisode;
    if (
      media.type === "ANIME" &&
      next &&
      next.airingAt * 1000 > now &&
      progress >= next.episode - 1
    )
      return [];
    const manga = availability.get(media.id);
    if (
      media.type === "MANGA" &&
      manga?.status === "available" &&
      manga.latestChapter !== undefined &&
      progress >= manga.latestChapter
    )
      return [];
    return [
      {
        ...title,
        label: media.type === "MANGA" ? "Choose next chapter" : `Continue episode ${progress + 1}`,
        targetUnit: progress + 1,
      },
    ];
  });
}

export function personalReleases(
  titles: PersonalTitle[],
  airing: PersonalAiringUpdate[],
  availability: Map<number, MangaDexChapterAvailability>,
  now = Date.now(),
): PersonalRelease[] {
  const releases: PersonalRelease[] = [];
  for (const { media, progress } of titles) {
    if (media.type === "ANIME") {
      const latest = airing
        .filter((row) => row.aniListId === media.id && row.airedAt * 1000 <= now)
        .sort((a, b) => b.episode - a.episode)[0];
      const key = `ANIME:${media.id}`;
      if (latest && latest.episode > progress)
        releases.push({
          key,
          unit: latest.episode,
          media,
          kind: "aired",
          timestamp: latest.airedAt * 1000,
        });
    } else {
      const latest = availability.get(media.id);
      if (latest?.status !== "available" || latest.latestChapter === undefined) continue;
      const key = `MANGA:${media.id}:${latest.translatedLanguage}`;
      if (latest.latestChapter > progress)
        releases.push({
          key,
          unit: latest.latestChapter,
          media,
          kind: "translated",
          language: latest.translatedLanguage,
          timestamp: Date.parse(latest.checkedAt),
        });
    }
  }
  return releases.sort((a, b) => b.timestamp - a.timestamp);
}
