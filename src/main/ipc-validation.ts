import type { IpcInvokeArgs, IpcInvokeChannel } from "../shared/ipc";
import { parseReaderSettings } from "../shared/reader-settings";
import { isMangaLanguage, type MangaLanguage } from "../shared/manga-languages";
import { parseMoreTitleSnapshot } from "./more-library";
import { normalizeActivityInput } from "../shared/activity";
import { parseBingeChange } from "../shared/binge";
import { parseBrowseFilters, type AniListBrowseFilters } from "../shared/anilist-filters";
import {
  MORE_GENRES,
  MORE_LANGUAGES,
  MORE_YEAR_MIN,
  type MoreBrowseInput,
} from "../shared/more-filters";
import {
  MAX_LIST_SCHEDULE_SPAN_SECONDS,
  MAX_SCHEDULE_MEDIA_IDS,
  MAX_SCHEDULE_SPAN_SECONDS,
} from "./anilist/airing-schedule";
import type {
  AiringScheduleInput,
  AniListEntryStatus,
  AniListMediaType,
  MoreMediaType,
  AnimeEpisodeCatalogInput,
  AnimePlaybackInput,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexPageInput,
  MangaDexReaderInput,
  KitsuHeroArtworkInput,
  SaveMangaReaderPreferencesInput,
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

function asRequestId(value: unknown): string {
  const requestId = asString(value);
  if (!/^[A-Za-z0-9:-]{1,128}$/.test(requestId)) fail();
  return requestId;
}

function asOptionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : asString(value);
}

function asMangaLanguage(value: unknown): MangaLanguage {
  const language = asString(value).trim().toLocaleLowerCase();
  // Manga is offered in English and Japanese only (user decision 2026-10-03).
  if (!isMangaLanguage(language)) fail();
  return language;
}

function asMirrorChapterId(value: unknown): string {
  const id = asString(value);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail();
  return id;
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

function asMoreMediaType(value: unknown): MoreMediaType {
  if (value !== "MOVIE" && value !== "TV") fail();
  return value as MoreMediaType;
}

function morePlaybackInput(value: unknown): import("../shared/contracts").MorePlaybackInput {
  const input = asRecord(value);
  const type = asMoreMediaType(input.type);
  const tmdbId = asPositiveInt(input.tmdbId);
  const season = asOptionalPositiveInt(input.season);
  const episode = asOptionalPositiveInt(input.episode);
  if (type === "MOVIE" && (season !== undefined || episode !== undefined)) fail();
  if (type === "TV" && (season === undefined || episode === undefined)) fail();
  return { tmdbId, type, season, episode };
}

function moreTitleSnapshot(value: unknown): import("../shared/contracts").MoreTitleSnapshot {
  return parseMoreTitleSnapshot(value) ?? fail();
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
  const type = asMediaType(input.type);
  let filters: AniListBrowseFilters;
  try {
    filters = parseBrowseFilters(type, input);
  } catch {
    return fail();
  }
  return {
    type,
    page: asPositiveInt(input.page),
    perPage: asOptionalPositiveInt(input.perPage),
    query: asOptionalString(input.query),
    genre: asOptionalString(input.genre),
    sort: asBrowseSort(input.sort),
    ...filters,
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

function airingScheduleInput(value: unknown): AiringScheduleInput {
  const record = asRecord(value);
  const start = asPositiveInt(record.start);
  const end = asPositiveInt(record.end);
  // Everything airing is fetched a week at a time; only the user's list may span a month grid.
  const maxSpan =
    record.mediaIds === undefined ? MAX_SCHEDULE_SPAN_SECONDS : MAX_LIST_SCHEDULE_SPAN_SECONDS;
  if (end <= start || end - start > maxSpan || end > 4_102_444_800) fail();
  if (record.mediaIds === undefined) return { start, end };
  if (!Array.isArray(record.mediaIds) || record.mediaIds.length > MAX_SCHEDULE_MEDIA_IDS) fail();
  const mediaIds = record.mediaIds.map(asPositiveInt);
  if (mediaIds.some((id) => id > 2_147_483_647)) fail();
  return { start, end, mediaIds };
}

function animeEpisodeCatalogInput(value: unknown): AnimeEpisodeCatalogInput {
  const input = asRecord(value);
  return {
    aniListId: asPositiveInt(input.aniListId),
    titles: asStringArray(input.titles),
    seasonLabel: asOptionalString(input.seasonLabel),
    totalEpisodes: asOptionalPositiveInt(input.totalEpisodes),
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

/** Profile pictures come only from AniList's CDN or Simkl's avatar host. */
export function isPicturePaletteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.hostname === "simkl.in") return url.pathname.startsWith("/avatars/");
    return url.hostname === "s4.anilist.co" || url.hostname === "img.anili.st";
  } catch {
    return false;
  }
}

function titleFeedbackRef(value: unknown): {
  type: "ANIME" | "MANGA" | "MOVIE" | "TV";
  id: number;
} {
  const input = asRecord(value);
  const type = input.type;
  if (type !== "ANIME" && type !== "MANGA" && type !== "MOVIE" && type !== "TV") fail();
  return { type, id: asPositiveInt(input.id) };
}

function updatePreferencesArgs(
  value: unknown[],
): [{ autoDownload: boolean; installOnQuit: boolean }] {
  const [raw] = argsOfLength(value, 1);
  const input = asRecord(raw);
  if (Object.keys(input).some((key) => key !== "autoDownload" && key !== "installOnQuit")) fail();
  if (typeof input.autoDownload !== "boolean" || typeof input.installOnQuit !== "boolean") fail();
  return [{ autoDownload: input.autoDownload, installOnQuit: input.installOnQuit }];
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
  "activity:record": (args) => {
    argsOfLength(args, 1);
    return [normalizeActivityInput(args[0])];
  },
  "binge:state": noArgs,
  "binge:apply": (value) => {
    const [raw] = argsOfLength(value, 1);
    const change = parseBingeChange(raw);
    if (!change) fail();
    return [change];
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
  "window:caption-controls": (value) => {
    const [visible] = argsOfLength(value, 1);
    if (typeof visible !== "boolean") fail();
    return [visible];
  },
  "anime:provider-readiness": noArgs,
  "app:update-status": noArgs,
  "app:check-updates": noArgs,
  "app:download-update": noArgs,
  "app:cancel-update-download": noArgs,
  "app:install-update": noArgs,
  "app:update-preferences": noArgs,
  "app:set-update-preferences": updatePreferencesArgs,
  "anilist:auth-state": noArgs,
  "anilist:login": noArgs,
  "simkl:status": noArgs,
  "simkl:connect": noArgs,
  "simkl:cancel": noArgs,
  "simkl:disconnect": noArgs,
  "simkl:sync": noArgs,
  "simkl:profile": noArgs,
  "simkl:stats": noArgs,
  "simkl:title-ratings": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    return [{ tmdbId: asPositiveInt(input.tmdbId), type: asMoreMediaType(input.type) }];
  },
  "profile:palette": (value) => {
    const [raw] = argsOfLength(value, 1);
    const url = asString(raw);
    if (url.length > 600 || !isPicturePaletteUrl(url)) fail();
    return [url];
  },
  "profile:hero": noArgs,
  "profile:hero-set": (value) => {
    const [raw] = argsOfLength(value, 1);
    if (!(raw instanceof Uint8Array) || raw.byteLength < 4 || raw.byteLength > 4 * 1024 * 1024)
      fail();
    // JPEG only: the renderer re-encodes the cropped image before sending it.
    if (raw[0] !== 0xff || raw[1] !== 0xd8 || raw[2] !== 0xff) fail();
    return [raw];
  },
  "profile:hero-clear": noArgs,
  "anilist:cancel-login": noArgs,
  "anilist:logout": noArgs,
  "request:cancel": (value) => {
    const [requestId] = argsOfLength(value, 1);
    return [asRequestId(requestId)];
  },
  "anilist:cached-dashboard": noArgs,
  "anilist:pending-changes": noArgs,
  "anilist:dashboard": noArgs,
  "anilist:browse": (value) => {
    const [input] = argsOfLength(value, 1);
    return [browseAniListInput(input)];
  },
  "anilist:media-by-ids": (value) => {
    const [ids, type] = argsOfLength(value, 2);
    if (!Array.isArray(ids) || ids.length > 12) fail();
    const parsed = ids.map(asPositiveInt);
    if (parsed.some((id) => id > 2147483647)) fail();
    return [parsed, asMediaType(type)];
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
  "anilist:filter-options": noArgs,
  "anilist:schedule": (value) => {
    const [raw] = argsOfLength(value, 1);
    return [airingScheduleInput(raw)];
  },
  "anime:episode-catalog": (value) => {
    const [input] = argsOfLength(value, 1);
    return [animeEpisodeCatalogInput(input)];
  },
  "anime:episode-art": (value) => {
    const [input] = argsOfLength(value, 1);
    const record = asRecord(input);
    const aniListId = asPositiveInt(record.aniListId);
    const episodes = asPositiveInt(record.episodes);
    const focus = asPositiveInt(record.focus);
    if (aniListId > 2147483647 || episodes > 5_000 || focus > 5_000) fail();
    return [{ aniListId, episodes, focus }];
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
  "more:trending": (value) => {
    const [type, page] = argsOfLength(value, 2);
    return [asMoreMediaType(type), asPositiveInt(page)];
  },
  "more:browse": (value) => {
    const [input] = argsOfLength(value, 1);
    const record = asRecord(input);
    const sort = record.sort;
    if (sort !== "popular" && sort !== "rated" && sort !== "newest") fail();
    const parsed: MoreBrowseInput = {
      type: asMoreMediaType(record.type),
      page: asPositiveInt(record.page),
      sort,
    };
    if (record.query !== undefined) {
      const query = asString(record.query).trim();
      if (query.length > 100) fail();
      if (query) parsed.query = query;
    }
    if (record.genre !== undefined) {
      if (!MORE_GENRES.some((genre) => genre.name === record.genre)) fail();
      parsed.genre = record.genre as string;
    }
    if (record.language !== undefined) {
      if (!MORE_LANGUAGES.some((language) => language.code === record.language)) fail();
      parsed.language = record.language as string;
    }
    if (record.year !== undefined) {
      const year = asPositiveInt(record.year);
      if (year < MORE_YEAR_MIN || year > new Date().getFullYear() + 2) fail();
      parsed.year = year;
    }
    if (record.minScore !== undefined) {
      const score = asPositiveInt(record.minScore);
      if (score > 10) fail();
      parsed.minScore = score;
    }
    if (parsed.page > 500) fail();
    return [parsed];
  },
  "more:search": (value) => {
    const [query, type, page] = argsOfLength(value, 3);
    const normalized = asString(query).trim();
    if (!normalized || normalized.length > 100) fail();
    return [normalized, asMoreMediaType(type), asPositiveInt(page)];
  },
  "more:detail": (value) => {
    const [id, type] = argsOfLength(value, 2);
    return [asPositiveInt(id), asMoreMediaType(type)];
  },
  "more:season": (value) => {
    const [id, season] = argsOfLength(value, 2);
    const seasonNumber = asNonNegativeInt(season);
    if (seasonNumber > 500) fail();
    return [asPositiveInt(id), seasonNumber];
  },
  "more:library": noArgs,
  "more:title-progress": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    return [{ tmdbId: asPositiveInt(input.tmdbId), type: asMoreMediaType(input.type) }];
  },
  "more:watchlist-set": (value) => {
    const [title, saved] = argsOfLength(value, 2);
    if (typeof saved !== "boolean") fail();
    return [moreTitleSnapshot(title), saved];
  },
  "more:title-status": (value) => {
    const [title, action] = argsOfLength(value, 2);
    if (action !== "planning" && action !== "unplanned" && action !== "completed") fail();
    return [moreTitleSnapshot(title), action];
  },
  "more:simkl-rows": noArgs,
  "personalization:settings": noArgs,
  "personalization:set-activity": (value) => {
    const [on] = argsOfLength(value, 1);
    if (typeof on !== "boolean") fail();
    return [on];
  },
  "personalization:set-hidden-tags": (value) => {
    const [names] = argsOfLength(value, 1);
    if (!Array.isArray(names) || names.length > 200) fail();
    if (!names.every((name) => typeof name === "string" && name.length <= 200)) fail();
    return [names as string[]];
  },
  "personalization:time-to-play": (value) => {
    const [section, seconds] = argsOfLength(value, 2);
    if (section !== "ANIME" && section !== "MANGA" && section !== "MORE") fail();
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 86_400)
      fail();
    return [section, seconds];
  },
  "personalization:feedback": (value) => {
    const [ref] = argsOfLength(value, 1);
    return [titleFeedbackRef(ref)];
  },
  "personalization:set-feedback": (value) => {
    const [ref, feedback] = argsOfLength(value, 2);
    if (feedback !== null && feedback !== "interested" && feedback !== "not-interested") fail();
    return [titleFeedbackRef(ref), feedback];
  },
  "more:rating": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    return [{ tmdbId: asPositiveInt(input.tmdbId), type: asMoreMediaType(input.type) }];
  },
  "more:rating-set": (value) => {
    const [title, rating] = argsOfLength(value, 2);
    if (
      rating !== null &&
      (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 10)
    )
      fail();
    return [moreTitleSnapshot(title), rating as number | null];
  },
  "more:remember": (value) => {
    const [title] = argsOfLength(value, 1);
    return [moreTitleSnapshot(title)];
  },
  "more:player-prepare": (value) => {
    const [raw] = argsOfLength(value, 1);
    const startAt = asOptionalNonNegativeNumber(asRecord(raw).startAtSeconds);
    const providerIndex = asOptionalNonNegativeInt(asRecord(raw).providerIndex);
    if (providerIndex !== undefined && providerIndex > 31) fail();
    return [
      {
        ...morePlaybackInput(raw),
        ...(startAt === undefined ? {} : { startAtSeconds: Math.floor(startAt) }),
        ...(providerIndex === undefined ? {} : { providerIndex }),
      },
    ];
  },
  "more:player-release": noArgs,
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
  "mangadex:chapter-readable": (value) => {
    const [input] = argsOfLength(value, 1);
    const chapterId = asString(asRecord(input).chapterId);
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(chapterId)) fail();
    return [{ chapterId }];
  },
  "manga:mirror-chapter": (value) => {
    const [input] = argsOfLength(value, 1);
    return [{ chapterId: asMirrorChapterId(asRecord(input).chapterId) }];
  },
  "manga:mirror-page": (value) => {
    const [input] = argsOfLength(value, 1);
    const record = asRecord(input);
    const page = record.page;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page > 999) fail();
    return [{ chapterId: asMirrorChapterId(record.chapterId), page }];
  },
  "playback:resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "manga:reading-resume": (value) => {
    const [aniListId] = argsOfLength(value, 1);
    return [asPositiveInt(aniListId)];
  },
  "more:resume": (value) => {
    const [input] = argsOfLength(value, 1);
    return [morePlaybackInput(input)];
  },
  "more:save-resume": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = morePlaybackInput(raw) as import("../shared/contracts").MorePlaybackInput;
    const record = asRecord(raw);
    const positionSeconds = asNonNegativeNumber(record.positionSeconds);
    const durationSeconds = asNonNegativeNumber(record.durationSeconds);
    if (durationSeconds <= 0 || positionSeconds > durationSeconds) fail();
    return [{ ...input, positionSeconds, durationSeconds }];
  },
  "more:clear-resume": (value) => {
    const [input] = argsOfLength(value, 1);
    return [morePlaybackInput(input)];
  },
  "discovery:for-you": (value) => {
    if (value.length === 2) {
      const [type, fresh] = argsOfLength(value, 2);
      if (typeof fresh !== "boolean") fail();
      return [asMediaType(type), fresh as boolean];
    }
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
  "more:for-you": (value) => {
    if (value.length === 0) return [];
    const [fresh] = argsOfLength(value, 1);
    if (typeof fresh !== "boolean") fail();
    return [fresh as boolean];
  },
  "more:for-you-feedback": (value) => {
    const [raw] = argsOfLength(value, 1);
    const input = asRecord(raw);
    const requestId = asString(input.requestId);
    if (!/^[a-zA-Z0-9-]{1,120}$/.test(requestId)) fail();
    if (input.action !== "dismiss" && input.action !== "undo") fail();
    return [
      {
        requestId,
        type: asMoreMediaType(input.type),
        tmdbId: asPositiveInt(input.tmdbId),
        action: input.action as "dismiss" | "undo",
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
