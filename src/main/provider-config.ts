import { existsSync, readFileSync } from "node:fs";

/**
 * Provider configuration, grouped by app section (Anime, Manga, More). Each section lists its
 * **database** providers (official metadata/tracking APIs built into AniStream, which can only be
 * toggled) and its **media** providers (what actually plays or delivers content), in priority
 * order. The first enabled media provider is the primary; later entries are fallbacks.
 *
 * Streaming-source endpoints are deliberately not part of the tracked source. The main process
 * reads them from a gitignored `providers.local.json` (see `providers.example.json` for the shape).
 * Without a valid media entry, the matching playback feature reports itself as unconfigured while
 * discovery, lists, manga, and local progress keep working.
 */
export const PROVIDER_CONFIG_FILE = "providers.local.json";

export type ProviderSectionName = "anime" | "manga" | "more";

/** Built-in database providers per section. Required ones cannot be disabled. */
const DATABASE_PROVIDERS = {
  anime: {
    anilist: { required: true },
    mal: { required: false },
    kitsu: { required: false },
    // Unofficial community mapping (episode thumbnails); user-approved 2026-10-13, off unless listed.
    anizip: { required: false },
  },
  manga: {
    anilist: { required: true },
    mangadex: { required: true },
    mangabaka: { required: false },
    mangaupdates: { required: false },
    mal: { required: false },
  },
  more: { tmdb: { required: true } },
} as const satisfies Record<ProviderSectionName, Record<string, { required: boolean }>>;

export type DatabaseProviderId<Section extends ProviderSectionName> =
  keyof (typeof DATABASE_PROVIDERS)[Section] & string;

export interface AnimeSourceConfig {
  /** Episode index URL listing recently updated series (one page, newest first). */
  recentIndexUrl: string;
  /** Episode index series URL template: `{seriesId}`. */
  seriesUrl: string;
  /** Embed URL template for an indexed episode: `{embedId}`, `{audio}`. */
  episodeEmbedUrl: string;
  /** Embed URL template by AniList ID: `{aniListId}`, `{episode}`, `{audio}`. */
  aniListEmbedUrl: string;
  /** Origin shared by both embed templates. */
  playerOrigin: string;
  /** Script allowlist for this player's frame; see `MorePlayerConfig.scriptHosts`. */
  scriptHosts?: string[];
  /** Script paths blocked on the player's own host; see `MorePlayerConfig.blockedScriptPaths`. */
  blockedScriptPaths?: string[];
  /** Tracker hosts refused for any request; see `MorePlayerConfig.blockedRequestHosts`. */
  blockedRequestHosts?: string[];
}

export interface MorePlayerConfig {
  /** Movie URL template: `{tmdbId}`. */
  movieUrl: string;
  /** Episode URL template: `{tmdbId}`, `{season}`, `{episode}`. */
  tvUrl: string;
  /** Query parameter the player reads as a resume position in seconds. */
  startAtParam?: string;
  /**
   * For players whose postMessage events are `{ type: "<prefix><event>", ...payload }` without a
   * TMDB id (e.g. `"player:"` for `player:timeupdate`); unset for `PLAYER_EVENT` players.
   */
  eventPrefix?: string;
  /**
   * Seconds this player may take to start playing before the next is tried, for players that try
   * several of their own servers first (10-60; the app default is 20).
   */
  startTimeoutSeconds?: number;
  /**
   * For players whose postMessage events are `{ source: "<eventSource>", event, info }` (the
   * PlayerJS API) without a TMDB id. `commandSource` marks commands sent back (`seek` to resume).
   */
  eventSource?: string;
  commandSource?: string;
  /**
   * The origin the embed URL redirects to, where the player document actually runs. Script rules,
   * message checks and the frame allowlist apply to it. Unset when the player stays on `origin`.
   */
  frameOrigin?: string;
  /**
   * Global names (e.g. an inline ad library) replaced by an inert stub in this player's frame
   * before its own scripts run, for ad code the page inlines and no URL rule can block.
   */
  stubGlobals?: string[];
  /**
   * Present a Chromium UA without Electron's token to this player's frame only. User-approved
   * 2026-10-01 for the original More player, which rejects the Electron token; never a default.
   */
  stripElectronUserAgent: boolean;
  /**
   * Frame this player with the HTML `sandbox` (scripts and its own storage only: no pop-ups, top
   * navigation, forms or modals). Opt-in (audit finding 6, 2026-10-28): every player configured
   * then refused playback when sandboxed, most saying so on screen, so none sets it today.
   */
  sandboxed?: true;
  /**
   * When set, scripts inside this player's frame load only from the player's own host (exactly)
   * and these hosts (or their subdomains). AniStream's principles are no ads and no third-party
   * trackers (user decision 2026-10-03); players' ad scripts also broke their controls.
   */
  scriptHosts?: string[];
  /**
   * Exact script paths (e.g. `/lib/ad.js`) blocked on the player's own host, for ad libraries the
   * player serves itself, which a host allowlist cannot tell apart from the player's code.
   */
  blockedScriptPaths?: string[];
  /**
   * Hosts (and their subdomains) refused for every request from this player's frame, not only
   * scripts: analytics beacons sent by the player's own allowed scripts (pixels, `sendBeacon`).
   */
  blockedRequestHosts?: string[];
  origin: string;
}

interface MediaProviderBase {
  /** Local, unique-per-section slug (used only in diagnostics). */
  id: string;
}

/** Episode index plus an embedded player addressed by index episode ID or AniList ID. */
export interface AnimeIndexedEmbedProvider extends MediaProviderBase, AnimeSourceConfig {
  kind: "indexed-embed";
}

/**
 * `direct-hls`: a source whose episode pages hand back a direct HLS stream, played by AniStream's
 * own player through the main-process stream proxy (user decision 2026-10-18). Matched to AniList
 * by search plus format/year/episode-count/first-air-date agreement. Endpoints live only in the
 * gitignored local config.
 */
export interface AnimeDirectHlsProvider extends MediaProviderBase {
  kind: "direct-hls";
  /** Title search page; needs `{query}`. */
  searchUrl: string;
  /** Series page with its episode list; needs `{slug}`, same origin as `searchUrl`. */
  titleUrl: string;
  /** Episode page with the player data; needs `{slug}` and `{episode}`, same origin. */
  episodeUrl: string;
  /** Optional `Referer` the stream proxy sends for this source's media (HTTPS origin). */
  referer?: string;
}

/**
 * `anilist-embed`: an embedded anime player addressed directly by AniList id and episode (user
 * decision 2026-10-31: first in the anime order, ahead of the indexed player). No episode index.
 */
export interface AnimeAniListEmbedProvider extends MediaProviderBase {
  kind: "anilist-embed";
  /** Episode URL template: `{aniListId}`, `{episode}`, `{audio}` (`sub` | `dub`). */
  episodeUrl: string;
  playerOrigin: string;
  /** Query parameter the player reads as a start position in seconds. */
  startAtParam?: string;
  /** Its postMessage events are `{ source: "<eventSource>", type: "event", name, data }`. */
  eventSource?: string;
  /** Script rules; see `MorePlayerConfig`. */
  scriptHosts?: string[];
  blockedScriptPaths?: string[];
  blockedRequestHosts?: string[];
  /** Globals stubbed in its frame before its scripts run; see `MorePlayerConfig.stubGlobals`. */
  stubGlobals?: string[];
}

export type AnimeMediaProvider =
  AnimeIndexedEmbedProvider | AnimeDirectHlsProvider | AnimeAniListEmbedProvider;

/**
 * Built-in manga chapter sources (no endpoints to configure):
 * - `mangadex`: MangaDex@Home in-app reading (primary).
 * - `official-links`: opt-in, off by default (user prefers in-app reading only). Adds chapters MangaDex
 *   cannot serve in-app as links to official sites (MangaDex publisher entries, MangaBaka chapter
 *   total and reading links).
 */
export interface MangaBuiltinProvider extends MediaProviderBase {
  kind: "mangadex" | "official-links";
}

/**
 * `chapter-mirror`: a removable, user-approved fallback site (scraped HTML) that fills English
 * chapter numbers MangaDex lacks; its chapters are read in-app. Identity comes from MAL-Sync's
 * exact AniList-ID mapping (`mappingSite` is MAL-Sync's site key). Endpoints live only in the
 * gitignored local config.
 */
export interface MangaChapterMirrorProvider extends MediaProviderBase {
  kind: "chapter-mirror";
  /** Display credit shown on mirror chapters. */
  label: string;
  mappingSite: string;
  /** Chapter list page for one series; needs `{seriesId}`. */
  chapterListUrl: string;
  /** Page-image list for one chapter; needs `{chapterId}`, same origin as `chapterListUrl`. */
  chapterPagesUrl: string;
  /** Optional image-host allowlist (exact host or a subdomain of it). */
  imageHosts?: string[];
}

export type MangaMediaProvider = MangaBuiltinProvider | MangaChapterMirrorProvider;

/** Embedded player addressed by TMDB ID. */
export interface MoreTmdbEmbedProvider extends MediaProviderBase, MorePlayerConfig {
  kind: "tmdb-embed";
}

export interface ProviderSection<Section extends ProviderSectionName, Media> {
  /** Enabled database providers, in configured order. Always includes the required ones. */
  database: DatabaseProviderId<Section>[];
  /** Enabled media providers in priority order: primary first, then fallbacks. */
  media: Media[];
}

export interface ProviderConfig {
  anime: ProviderSection<"anime", AnimeMediaProvider>;
  manga: ProviderSection<"manga", MangaMediaProvider>;
  more: ProviderSection<"more", MoreTmdbEmbedProvider>;
}

export function loadProviderConfig(paths: readonly string[]): ProviderConfig {
  const path = paths.find((candidate) => existsSync(candidate));
  if (!path) return parseProviderConfig({});
  try {
    return parseProviderConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    console.warn("AniStream ignored an unreadable local provider configuration file.");
    return parseProviderConfig({});
  }
}

export function parseProviderConfig(raw: unknown): ProviderConfig {
  const value = upgradeLegacyShape(isRecord(raw) ? raw : {});
  return {
    anime: parseSection("anime", value.anime, parseAnimeMedia, []),
    manga: parseSection("manga", value.manga, parseMangaMedia, [
      { id: "mangadex", kind: "mangadex" },
    ]),
    more: parseSection("more", value.more, parseMoreMedia, []),
  };
}

/** The primary (first enabled) media provider of a section, if any. */
export function primaryMedia<Media>(section: { media: readonly Media[] }): Media | undefined {
  return section.media[0];
}

export function isDatabaseEnabled<Section extends ProviderSectionName>(
  config: ProviderConfig,
  section: Section,
  id: DatabaseProviderId<Section>,
): boolean {
  return (config[section].database as readonly string[]).includes(id);
}

/** Every configured third-party player origin the renderer may frame. */
export function embeddedPlayerOrigins(config: ProviderConfig): string[] {
  return [
    ...new Set([
      ...config.anime.media.flatMap((provider) =>
        provider.kind === "indexed-embed" || provider.kind === "anilist-embed"
          ? [provider.playerOrigin]
          : [],
      ),
      ...config.more.media.flatMap((provider) =>
        provider.frameOrigin ? [provider.origin, provider.frameOrigin] : [provider.origin],
      ),
    ]),
  ];
}

/** Replaces `{name}` placeholders with URL-encoded values. */
export function fillUrlTemplate(template: string, values: Record<string, string | number>): string {
  return template.replaceAll(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    name in values ? encodeURIComponent(String(values[name])) : match,
  );
}

/**
 * Accepts the original single-provider shape (`animeSource`, `morePlayer`) so an existing local
 * file or CI secret keeps working; it is converted to one media entry per section.
 */
function upgradeLegacyShape(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.animeSource === undefined && raw.morePlayer === undefined) return raw;
  console.warn(
    "AniStream read a legacy provider configuration; move it to the anime/manga/more sections.",
  );
  const legacyMedia = (entry: unknown, id: string, kind: string, extra: object = {}) =>
    isRecord(entry) ? { media: [{ id, kind, ...extra, ...entry }] } : undefined;
  return {
    anime: raw.anime ?? legacyMedia(raw.animeSource, "anime-player", "indexed-embed"),
    manga: raw.manga,
    more:
      raw.more ??
      legacyMedia(raw.morePlayer, "more-player", "tmdb-embed", {
        // The legacy shape always applied the approved UA override.
        stripElectronUserAgent: true,
      }),
  };
}

function parseSection<Section extends ProviderSectionName, Media extends MediaProviderBase>(
  name: Section,
  value: unknown,
  parseMedia: (entry: Record<string, unknown>, id: string) => Media,
  defaultMedia: Media[],
): ProviderSection<Section, Media> {
  if (value !== undefined && !isRecord(value)) {
    console.warn(`AniStream ignored the "${name}" provider section: expected an object.`);
    value = undefined;
  }
  const section = (value ?? {}) as Record<string, unknown>;
  return {
    database: parseDatabase(name, section.database),
    media:
      section.media === undefined ? defaultMedia : parseMediaList(name, section.media, parseMedia),
  };
}

function parseDatabase<Section extends ProviderSectionName>(
  section: Section,
  value: unknown,
): DatabaseProviderId<Section>[] {
  const known: Record<string, { required: boolean }> = DATABASE_PROVIDERS[section];
  const all = Object.keys(known) as DatabaseProviderId<Section>[];
  if (value === undefined) return all;
  if (!Array.isArray(value)) {
    console.warn(`AniStream ignored "${section}.database": expected a list.`);
    return all;
  }
  const enabled: string[] = [];
  const listed = new Set<string>();
  for (const entry of value) {
    const id = isRecord(entry) ? entry.id : undefined;
    if (typeof id !== "string" || !Object.hasOwn(known, id)) {
      console.warn(`AniStream ignored an unknown "${section}" database provider.`);
      continue;
    }
    if (listed.has(id)) continue;
    listed.add(id);
    if (isRecord(entry) && entry.enabled === false) {
      if (known[id]!.required)
        console.warn(`AniStream kept "${section}.${id}" enabled because the section requires it.`);
      else continue;
    }
    enabled.push(id);
  }
  // Required providers that were left out still run; unlisted optional ones stay off.
  for (const id of all) if (known[id]!.required && !enabled.includes(id)) enabled.push(id);
  return enabled as DatabaseProviderId<Section>[];
}

function parseMediaList<Media extends MediaProviderBase>(
  section: ProviderSectionName,
  value: unknown,
  parseMedia: (entry: Record<string, unknown>, id: string) => Media,
): Media[] {
  if (!Array.isArray(value)) {
    console.warn(`AniStream disabled "${section}.media": expected a list.`);
    return [];
  }
  const media: Media[] = [];
  value.forEach((entry, index) => {
    const label = isRecord(entry) && typeof entry.id === "string" ? entry.id : `entry ${index + 1}`;
    try {
      if (!isRecord(entry)) throw new Error("expected an object");
      if (entry.enabled === false) return;
      const id = providerId(entry.id);
      if (media.some((provider) => provider.id === id)) throw new Error("duplicate id");
      media.push(parseMedia(entry, id));
    } catch (reason) {
      console.warn(
        `AniStream disabled the "${section}" media provider "${label}": ${reason instanceof Error ? reason.message : "invalid"}.`,
      );
    }
  });
  return media;
}

function parseAnimeMedia(value: Record<string, unknown>, id: string): AnimeMediaProvider {
  if (value.kind === "direct-hls") return parseDirectHls(value, id);
  if (value.kind === "anilist-embed") return parseAniListEmbed(value, id);
  if (value.kind !== "indexed-embed")
    throw new Error('kind must be "indexed-embed", "anilist-embed" or "direct-hls"');
  const recentIndexUrl = template(value.recentIndexUrl, "recentIndexUrl", []);
  const seriesUrl = template(value.seriesUrl, "seriesUrl", ["seriesId"]);
  sameOrigin([recentIndexUrl, seriesUrl]);
  const episodeEmbedUrl = template(value.episodeEmbedUrl, "episodeEmbedUrl", ["embedId", "audio"]);
  const aniListEmbedUrl = template(value.aniListEmbedUrl, "aniListEmbedUrl", [
    "aniListId",
    "episode",
    "audio",
  ]);
  const playerOrigin = sameOrigin([episodeEmbedUrl, aniListEmbedUrl]);
  return {
    id,
    kind: "indexed-embed",
    recentIndexUrl,
    seriesUrl,
    episodeEmbedUrl,
    aniListEmbedUrl,
    playerOrigin,
    ...scriptRules(value),
  };
}

function parseAniListEmbed(value: Record<string, unknown>, id: string): AnimeAniListEmbedProvider {
  const episodeUrl = template(value.episodeUrl, "episodeUrl", ["aniListId", "episode", "audio"]);
  let startAtParam: string | undefined;
  if (value.startAtParam !== undefined) {
    if (
      typeof value.startAtParam !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value.startAtParam)
    )
      throw new Error("startAtParam must be a short query parameter name");
    startAtParam = value.startAtParam;
  }
  const eventSource = messageSource(value.eventSource, "eventSource");
  const stubGlobals = globalNames(value.stubGlobals);
  return {
    id,
    kind: "anilist-embed",
    episodeUrl,
    playerOrigin: sameOrigin([episodeUrl]),
    ...(startAtParam ? { startAtParam } : {}),
    ...(eventSource ? { eventSource } : {}),
    ...(stubGlobals ? { stubGlobals } : {}),
    ...scriptRules(value),
  };
}

function parseDirectHls(value: Record<string, unknown>, id: string): AnimeDirectHlsProvider {
  const searchUrl = template(value.searchUrl, "searchUrl", ["query"]);
  const titleUrl = template(value.titleUrl, "titleUrl", ["slug"]);
  const episodeUrl = template(value.episodeUrl, "episodeUrl", ["slug", "episode"]);
  sameOrigin([searchUrl, titleUrl, episodeUrl]);
  let referer: string | undefined;
  if (value.referer !== undefined) {
    const url = httpsUrl(value.referer, "referer");
    referer = `${url.origin}/`;
  }
  return {
    id,
    kind: "direct-hls",
    searchUrl,
    titleUrl,
    episodeUrl,
    ...(referer ? { referer } : {}),
  };
}

function parseMangaMedia(value: Record<string, unknown>, id: string): MangaMediaProvider {
  if (value.kind === "chapter-mirror") return parseChapterMirror(value, id);
  if (value.kind !== "mangadex" && value.kind !== "official-links")
    throw new Error('kind must be "mangadex", "official-links", or "chapter-mirror"');
  return { id, kind: value.kind };
}

function parseChapterMirror(
  value: Record<string, unknown>,
  id: string,
): MangaChapterMirrorProvider {
  if (typeof value.label !== "string" || !/^[\w .'&-]{1,40}$/.test(value.label))
    throw new Error("label must be a short display name");
  if (typeof value.mappingSite !== "string" || !/^[A-Za-z0-9 _-]{1,40}$/.test(value.mappingSite))
    throw new Error("mappingSite must be a MAL-Sync site key");
  const chapterListUrl = template(value.chapterListUrl, "chapterListUrl", ["seriesId"]);
  const chapterPagesUrl = template(value.chapterPagesUrl, "chapterPagesUrl", ["chapterId"]);
  sameOrigin([chapterListUrl, chapterPagesUrl]);
  const imageHosts = hostList(value.imageHosts, "imageHosts");
  return {
    id,
    kind: "chapter-mirror",
    label: value.label,
    mappingSite: value.mappingSite,
    chapterListUrl,
    chapterPagesUrl,
    ...(imageHosts ? { imageHosts } : {}),
  };
}

function parseMoreMedia(value: Record<string, unknown>, id: string): MoreTmdbEmbedProvider {
  if (value.kind !== "tmdb-embed") throw new Error('kind must be "tmdb-embed"');
  const movieUrl = template(value.movieUrl, "movieUrl", ["tmdbId"]);
  const tvUrl = template(value.tvUrl, "tvUrl", ["tmdbId", "season", "episode"]);
  let startAtParam: string | undefined;
  if (value.startAtParam !== undefined) {
    if (
      typeof value.startAtParam !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value.startAtParam)
    )
      throw new Error("startAtParam must be a short query parameter name");
    startAtParam = value.startAtParam;
  }
  let eventPrefix: string | undefined;
  if (value.eventPrefix !== undefined) {
    if (
      typeof value.eventPrefix !== "string" ||
      !/^[a-z][a-z0-9_-]{0,31}:$/.test(value.eventPrefix)
    )
      throw new Error('eventPrefix must be a short lowercase name ending in ":"');
    eventPrefix = value.eventPrefix;
  }
  const startTimeoutSeconds = value.startTimeoutSeconds;
  if (
    startTimeoutSeconds !== undefined &&
    (typeof startTimeoutSeconds !== "number" ||
      !Number.isInteger(startTimeoutSeconds) ||
      startTimeoutSeconds < 10 ||
      startTimeoutSeconds > 60)
  )
    throw new Error("startTimeoutSeconds must be a whole number from 10 to 60");
  const eventSource = messageSource(value.eventSource, "eventSource");
  const commandSource = messageSource(value.commandSource, "commandSource");
  if (commandSource && !eventSource) throw new Error("commandSource needs eventSource");
  if (eventSource && eventPrefix) throw new Error("use eventPrefix or eventSource, not both");
  const frameOrigin =
    value.frameOrigin === undefined ? undefined : exactOrigin(value.frameOrigin, "frameOrigin");
  const stubGlobals = globalNames(value.stubGlobals);
  if (
    value.stripElectronUserAgent !== undefined &&
    typeof value.stripElectronUserAgent !== "boolean"
  )
    throw new Error("stripElectronUserAgent must be true or false");
  if (value.sandboxed !== undefined && typeof value.sandboxed !== "boolean")
    throw new Error("sandboxed must be true or false");
  return {
    id,
    kind: "tmdb-embed",
    movieUrl,
    tvUrl,
    startAtParam,
    ...(eventPrefix ? { eventPrefix } : {}),
    ...(typeof startTimeoutSeconds === "number" ? { startTimeoutSeconds } : {}),
    ...(eventSource ? { eventSource } : {}),
    ...(commandSource ? { commandSource } : {}),
    ...(frameOrigin ? { frameOrigin } : {}),
    ...(stubGlobals ? { stubGlobals } : {}),
    stripElectronUserAgent: value.stripElectronUserAgent === true,
    ...(value.sandboxed === true ? { sandboxed: true as const } : {}),
    ...scriptRules(value),
    origin: sameOrigin([movieUrl, tvUrl]),
  };
}

/** Optional script filter rules shared by every embedded player entry. */
function scriptRules(value: Record<string, unknown>): {
  scriptHosts?: string[];
  blockedScriptPaths?: string[];
  blockedRequestHosts?: string[];
} {
  // An empty allowlist is meaningful: scripts load from the player's own host only.
  const scriptHosts = hostList(value.scriptHosts, "scriptHosts", { allowEmpty: true });
  const blockedScriptPaths = pathList(value.blockedScriptPaths, "blockedScriptPaths");
  const blockedRequestHosts = hostList(value.blockedRequestHosts, "blockedRequestHosts");
  return {
    ...(scriptHosts ? { scriptHosts } : {}),
    ...(blockedScriptPaths ? { blockedScriptPaths } : {}),
    ...(blockedRequestHosts ? { blockedRequestHosts } : {}),
  };
}

function pathList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 20 ||
    !value.every((path) => typeof path === "string" && /^\/[A-Za-z0-9._~/-]{1,199}$/.test(path))
  )
    throw new Error(`${name} must be a list of absolute URL paths`);
  return value as string[];
}

function hostList(
  value: unknown,
  name: string,
  options: { allowEmpty?: boolean } = {},
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    (value.length === 0 && !options.allowEmpty) ||
    value.length > 20 ||
    !value.every(
      (host) => typeof host === "string" && /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host),
    )
  )
    throw new Error(`${name} must be a list of lowercase host names`);
  return value as string[];
}

function providerId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value))
    throw new Error("id must be a short lowercase slug");
  return value;
}

function template(value: unknown, name: string, placeholders: readonly string[]): string {
  if (typeof value !== "string" || value.length > 2_048) throw new Error(`${name} is missing`);
  for (const placeholder of placeholders)
    if (!value.includes(`{${placeholder}}`)) throw new Error(`${name} needs {${placeholder}}`);
  // Validate the URL shape with harmless sample values.
  httpsUrl(fillUrlTemplate(value, Object.fromEntries(placeholders.map((key) => [key, "1"]))), name);
  return value;
}

function httpsUrl(value: unknown, name: string): URL {
  if (typeof value !== "string") throw new Error(`${name} is missing`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(`${name} must be a credential-free https:// URL`);
  return url;
}

function globalNames(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 10 ||
    !value.every((name) => typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name))
  )
    throw new Error("stubGlobals must be a list of JavaScript global names");
  return value as string[];
}

function messageSource(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))
    throw new Error(`${name} must be a short identifier`);
  return value;
}

/** A bare `https://host[:port]` origin, nothing else. */
function exactOrigin(value: unknown, name: string): string {
  const url = httpsUrl(value, name);
  if (`${url.origin}` !== value) throw new Error(`${name} must be a bare https origin`);
  return url.origin;
}

function sameOrigin(templates: readonly string[]): string {
  const origins = new Set(
    templates.map((value) => new URL(fillUrlTemplate(value, sampleValues(value))).origin),
  );
  if (origins.size !== 1) throw new Error("related templates must share one origin");
  return [...origins][0]!;
}

function sampleValues(value: string): Record<string, string> {
  return Object.fromEntries(
    [...value.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => [match[1]!, "1"]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
