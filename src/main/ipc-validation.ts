import type { IpcInvokeArgs, IpcInvokeChannel } from "../shared/ipc";
import { parseReaderSettings } from "../shared/reader-settings";
import { validReleaseAcknowledgement } from "./personal-repository";
import { normalizeActivityInput } from "../shared/activity";
import type {
  AniListEntryStatus,
  AniListMediaType,
  AnimeEpisodeCatalogInput,
  AnimePlaybackInput,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexPageInput,
  MangaDexReaderInput,
  KitsuHeroArtworkInput,
  SaveMangaReadingResumeInput,
  SaveMangaReaderPreferencesInput,
  SavePlaybackResumeInput,
  UpdateAniListEntryInput,
} from "../shared/contracts";
import {
  isValidMangaReadingResumeInput,
  isValidPlaybackResumeInput,
} from "../shared/resume-validation";

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

function asRequestId(value: unknown): string {
  const requestId = asString(value);
  if (!/^[A-Za-z0-9:-]{1,128}$/.test(requestId)) fail();
  return requestId;
}

function asOptionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : asString(value);
}

function asMangaLanguage(value: unknown): string {
  const language = asString(value).trim().toLocaleLowerCase();
  if (!/^[a-z]{2}(?:-[a-z]{2,4})?$/.test(language)) fail();
  return language;
}

function asOptionalSafeId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const id = asString(value);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) fail();
  return id;
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

function kitsuHeroArtworkInput(value: unknown): KitsuHeroArtworkInput {
  const input = asRecord(value);
  const title = asString(input.title).trim();
  if (title.length === 0 || title.length > 200) fail();
  return {
    aniListId: asPositiveInt(input.aniListId),
    type: asMediaType(input.type),
    title,
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
    return {
      aniListId: asPositiveInt(input.aniListId),
      title: asString(input.title),
      translatedLanguage:
        input.translatedLanguage === undefined
          ? undefined
          : asMangaLanguage(input.translatedLanguage),
    };
  });
}

function mangaDexReaderInput(value: unknown): MangaDexReaderInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    title: asString(input.title),
    translatedLanguage:
      input.translatedLanguage === undefined
        ? undefined
        : asMangaLanguage(input.translatedLanguage),
    preferredGroupId: asOptionalSafeId(input.preferredGroupId),
  };
}

function saveMangaReaderPreferencesInput(value: unknown): SaveMangaReaderPreferencesInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    translatedLanguage: asMangaLanguage(input.translatedLanguage),
    preferredGroupId: asOptionalSafeId(input.preferredGroupId),
  };
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
  const parsed: SavePlaybackResumeInput = {
    aniListId: asPositiveInt(input.aniListId),
    episode: asNonNegativeNumber(input.episode),
    positionSeconds: asNonNegativeNumber(input.positionSeconds),
    durationSeconds: asNonNegativeNumber(input.durationSeconds),
  };
  if (!isValidPlaybackResumeInput(parsed)) fail();
  return parsed;
}

function saveMangaReadingResumeInput(value: unknown): SaveMangaReadingResumeInput {
  const input = asRecord(value);
  const parsed: SaveMangaReadingResumeInput = {
    aniListId: asPositiveInt(input.aniListId),
    chapterId: asString(input.chapterId),
    chapterNumber: asOptionalNonNegativeNumber(input.chapterNumber),
    progress: asNonNegativeNumber(input.progress),
  };
  if (!isValidMangaReadingResumeInput(parsed)) fail();
  return parsed;
}

function noArgs(value: unknown[]): [] {
  argsOfLength(value, 0);
  return [];
}

export const ipcArgValidators: IpcArgValidatorMap = {
  "backup:export": noArgs,
  "backup:prepare": noArgs,
  "backup:restore": (value) => {
    const [token] = argsOfLength(value, 1);
    const parsed = asString(token);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(parsed)) fail();
    return [parsed];
  },
  "backup:cancel": (value) => {
    const [token] = argsOfLength(value, 1);
    const parsed = asString(token);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(parsed)) fail();
    return [parsed];
  },
  "reader:settings": (value) => {
    argsOfLength(value, 0);
    return [];
  },
  "reader:save-settings": (value) => {
    argsOfLength(value, 1);
    return [parseReaderSettings(value[0])];
  },
  "personal:anime-updates": (value) => {
    const [ids] = argsOfLength(value, 1);
    if (!Array.isArray(ids) || ids.length > 24) fail();
    const parsed = ids.map(asPositiveInt);
    if (parsed.some((id) => id > 2147483647)) fail();
    return [parsed];
  },
  "personal:acknowledgements": noArgs,
  "personal:acknowledge": (value) => {
    const [raw] = argsOfLength(value, 1);
    const record = asRecord(raw);
    const input = { key: asString(record.key), unit: asNonNegativeNumber(record.unit) };
    if (!validReleaseAcknowledgement(input)) fail();
    return [input];
  },
  "activity:record": (args) => {
    argsOfLength(args, 1);
    return [normalizeActivityInput(args[0])];
  },
  "activity:list": (args) => {
    argsOfLength(args, 0);
    return [];
  },
  "activity:retry": (args) => {
    argsOfLength(args, 0);
    return [];
  },
  "app:get-info": noArgs,
  "anime:provider-readiness": noArgs,
  "app:update-status": noArgs,
  "app:check-updates": noArgs,
  "anilist:auth-state": noArgs,
  "anilist:login": noArgs,
  "anilist:cancel-login": noArgs,
  "anilist:logout": noArgs,
  "request:cancel": (value) => {
    const [requestId] = argsOfLength(value, 1);
    return [asRequestId(requestId)];
  },
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
  "kitsu:hero-art": (value) => {
    const [input] = argsOfLength(value, 1);
    return [kitsuHeroArtworkInput(input)];
  },
  "mangadex:latest": (value) => {
    const [page] = argsOfLength(value, 1);
    return [asPositiveInt(page)];
  },
  "mangadex:availability": (value) => {
    const [media] = argsOfLength(value, 1);
    return [mangaDexAvailabilityInput(media)];
  },
  "manga:title-snapshot": (value) => {
    const [input, requestId] = argsOfLength(value, 2);
    return [mangaDexReaderInput(input), asRequestId(requestId)];
  },
  "manga:save-reader-preferences": (value) => {
    const [input] = argsOfLength(value, 1);
    return [saveMangaReaderPreferencesInput(input)];
  },
  "mangadex:page": (value) => {
    const [input] = argsOfLength(value, 1);
    return [mangaDexPageInput(input)];
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
  "discovery:for-you": (value) => {
    const [type] = argsOfLength(value, 1);
    return [asMediaType(type)];
  },
  "discovery:feedback": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    const requestId = asString(input.requestId);
    if (!/^[a-zA-Z0-9-]{1,120}$/.test(requestId)) fail();
    if (input.action !== "dismiss" && input.action !== "undo" && input.action !== "explore") fail();
    return [
      {
        requestId,
        anilistId: asPositiveInt(input.anilistId),
        action: input.action as "dismiss" | "undo" | "explore",
      },
    ];
  },
  "discovery:impressions": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    const requestId = asString(input.requestId);
    if (
      !/^[a-zA-Z0-9-]{1,120}$/.test(requestId) ||
      !Array.isArray(input.anilistIds) ||
      input.anilistIds.length > 10
    )
      fail();
    return [{ requestId, anilistIds: (input.anilistIds as unknown[]).map(asPositiveInt) }];
  },
};
