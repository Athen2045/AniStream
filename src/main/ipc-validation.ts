import type { IpcInvokeArgs, IpcInvokeChannel } from "../shared/ipc";
import type {
  AniListEntryStatus,
  AniListMediaType,
  AnimeEpisodeCatalogInput,
  AnimePlaybackInput,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexPageInput,
  MangaDexReaderInput,
  SaveMangaReadingResumeInput,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";

export type IpcArgValidator<Channel extends IpcInvokeChannel> = (
  args: unknown[],
) => IpcInvokeArgs<Channel>;

/**
 * The runtime seam between the typed preload bridge and the domain IPC modules.
 * TypeScript's compile-time arg types disappear once a value crosses the IPC
 * boundary, so every channel gets a hand-checked shape here instead of the
 * handler trusting an `as` cast on renderer-supplied data.
 */
export type IpcArgValidatorMap = { [Channel in IpcInvokeChannel]: IpcArgValidator<Channel> };

function fail(): never {
  throw new Error("AniStream rejected malformed IPC arguments.");
}

function argsOfLength(value: unknown[], length: number): unknown[] {
  if (value.length !== length) fail();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value !== "string") fail();
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : asString(value);
}

function asPositiveInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) fail();
  return value;
}

function asOptionalPositiveInt(value: unknown): number | undefined {
  return value === undefined ? undefined : asPositiveInt(value);
}

function asNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail();
  return value;
}

function asOptionalNonNegativeInt(value: unknown): number | undefined {
  return value === undefined ? undefined : asNonNegativeInt(value);
}

function asNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail();
  return value;
}

function asOptionalNonNegativeNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : asNonNegativeNumber(value);
}

function asMediaType(value: unknown): AniListMediaType {
  if (value !== "ANIME" && value !== "MANGA") fail();
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) fail();
  return value as string[];
}

function asEntryStatus(value: unknown): AniListEntryStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === "CURRENT" ||
    value === "PLANNING" ||
    value === "COMPLETED" ||
    value === "DROPPED" ||
    value === "PAUSED" ||
    value === "REPEATING"
  )
    return value;
  return fail();
}

function asBrowseSort(value: unknown): BrowseAniListInput["sort"] {
  if (value === undefined) return undefined;
  if (
    value === "TRENDING_DESC" ||
    value === "POPULARITY_DESC" ||
    value === "SCORE_DESC" ||
    value === "START_DATE_DESC"
  )
    return value;
  return fail();
}

function asPageQuality(value: unknown): MangaDexPageInput["quality"] {
  if (value === undefined) return undefined;
  if (value === "data" || value === "data-saver") return value;
  return fail();
}

function asPlaybackAudio(value: unknown): AnimePlaybackInput["audio"] {
  if (value === undefined) return undefined;
  if (value === "sub" || value === "dub") return value;
  return fail();
}

function browseAniListInput(value: unknown): BrowseAniListInput {
  const input = asRecord(value);
  return {
    type: asMediaType(input.type),
    page: asPositiveInt(input.page),
    perPage: asOptionalPositiveInt(input.perPage),
    query: asOptionalString(input.query),
    genre: asOptionalString(input.genre),
    sort: asBrowseSort(input.sort),
  };
}

function updateAniListEntryInput(value: unknown): UpdateAniListEntryInput {
  const input = asRecord(value);
  return {
    id: asPositiveInt(input.id),
    status: asEntryStatus(input.status),
    score: asOptionalNonNegativeNumber(input.score),
    progress: asOptionalNonNegativeInt(input.progress),
    progressVolumes: asOptionalNonNegativeInt(input.progressVolumes),
    repeat: asOptionalNonNegativeInt(input.repeat),
    notes: asOptionalString(input.notes),
  };
}

function animeEpisodeCatalogInput(value: unknown): AnimeEpisodeCatalogInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    titles: asStringArray(input.titles),
    seasonLabel: asOptionalString(input.seasonLabel),
    totalEpisodes: asOptionalPositiveInt(input.totalEpisodes),
    fallbackThumbnailUrl: asOptionalString(input.fallbackThumbnailUrl),
    fallbackDescription: asOptionalString(input.fallbackDescription),
  };
}

function animePlaybackInput(value: unknown): AnimePlaybackInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    title: asString(input.title),
    episode: asNonNegativeNumber(input.episode),
    providerEpisodeId: asOptionalString(input.providerEpisodeId),
    audio: asPlaybackAudio(input.audio),
  };
}

function mangaDexAvailabilityInput(value: unknown): MangaDexAvailabilityInput[] {
  if (!Array.isArray(value)) fail();
  return value.map((item) => {
    const input = asRecord(item);
    return { aniListId: asPositiveInt(input.aniListId), title: asString(input.title) };
  });
}

function mangaDexReaderInput(value: unknown): MangaDexReaderInput {
  const input = asRecord(value);
  return { aniListId: asPositiveInt(input.aniListId), title: asString(input.title) };
}

function mangaDexPageInput(value: unknown): MangaDexPageInput {
  const input = asRecord(value);
  return {
    chapterId: asString(input.chapterId),
    page: asNonNegativeInt(input.page),
    quality: asPageQuality(input.quality),
  };
}

function savePlaybackResumeInput(value: unknown): SavePlaybackResumeInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    episode: asNonNegativeNumber(input.episode),
    positionSeconds: asNonNegativeNumber(input.positionSeconds),
    durationSeconds: asNonNegativeNumber(input.durationSeconds),
  };
}

function saveMangaReadingResumeInput(value: unknown): SaveMangaReadingResumeInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    chapterId: asString(input.chapterId),
    chapterNumber: asOptionalNonNegativeNumber(input.chapterNumber),
    progress: asNonNegativeInt(input.progress),
  };
}

function noArgs(value: unknown[]): [] {
  argsOfLength(value, 0);
  return [];
}

export const ipcArgValidators: IpcArgValidatorMap = {
  "app:get-info": noArgs,
  "anilist:auth-state": noArgs,
  "anilist:login": noArgs,
  "anilist:logout": noArgs,
  "anilist:cached-dashboard": noArgs,
  "anilist:dashboard": noArgs,
  "anilist:search": (value) => {
    const [query, type] = argsOfLength(value, 2);
    return [asString(query), asMediaType(type)];
  },
  "anilist:browse": (value) => {
    const [input] = argsOfLength(value, 1);
    return [browseAniListInput(input)];
  },
  "anilist:media-detail": (value) => {
    const [id, type] = argsOfLength(value, 2);
    return [asPositiveInt(id), asMediaType(type)];
  },
  "anilist:add-entry": (value) => {
    const [mediaId] = argsOfLength(value, 1);
    return [asPositiveInt(mediaId)];
  },
  "anilist:update-entry": (value) => {
    const [input] = argsOfLength(value, 1);
    return [updateAniListEntryInput(input)];
  },
  "anilist:delete-entry": (value) => {
    const [id] = argsOfLength(value, 1);
    return [asPositiveInt(id)];
  },
  "anilist:latest-anime": (value) => {
    const [page] = argsOfLength(value, 1);
    return [asPositiveInt(page)];
  },
  "anime:episode-catalog": (value) => {
    const [input] = argsOfLength(value, 1);
    return [animeEpisodeCatalogInput(input)];
  },
  "anime:playback": (value) => {
    const [input] = argsOfLength(value, 1);
    return [animePlaybackInput(input)];
  },
  "mal:score": (value) => {
    const [type, malId] = argsOfLength(value, 2);
    return [asMediaType(type), asPositiveInt(malId)];
  },
  "mal:trending-fallback": (value) => {
    const [type] = argsOfLength(value, 1);
    return [asMediaType(type)];
  },
  "mangadex:latest": (value) => {
    const [page] = argsOfLength(value, 1);
    return [asPositiveInt(page)];
  },
  "mangadex:availability": (value) => {
    const [media] = argsOfLength(value, 1);
    return [mangaDexAvailabilityInput(media)];
  },
  "mangadex:reader": (value) => {
    const [input] = argsOfLength(value, 1);
    return [mangaDexReaderInput(input)];
  },
  "mangadex:page": (value) => {
    const [input] = argsOfLength(value, 1);
    return [mangaDexPageInput(input)];
  },
  "manga:enrichment": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "playback:resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "playback:save-resume": (value) => {
    const [input] = argsOfLength(value, 1);
    return [savePlaybackResumeInput(input)];
  },
  "playback:clear-resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "manga:reading-resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "manga:save-reading-resume": (value) => {
    const [input] = argsOfLength(value, 1);
    return [saveMangaReadingResumeInput(input)];
  },
  "manga:clear-reading-resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
};
