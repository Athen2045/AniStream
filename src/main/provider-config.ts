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
  anime: { anilist: { required: true }, mal: { required: false }, kitsu: { required: false } },
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
   * Present a Chromium UA without Electron's token to this player's frame only. User-approved
   * 2026-10-01 for the original More player, which rejects the Electron token; never a default.
   */
  stripElectronUserAgent: boolean;
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
  anime: ProviderSection<"anime", AnimeIndexedEmbedProvider>;
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
      ...config.anime.media.map((provider) => provider.playerOrigin),
      ...config.more.media.map((provider) => provider.origin),
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

function parseAnimeMedia(value: Record<string, unknown>, id: string): AnimeIndexedEmbedProvider {
  if (value.kind !== "indexed-embed") throw new Error('kind must be "indexed-embed"');
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
  if (
    value.stripElectronUserAgent !== undefined &&
    typeof value.stripElectronUserAgent !== "boolean"
  )
    throw new Error("stripElectronUserAgent must be true or false");
  return {
    id,
    kind: "tmdb-embed",
    movieUrl,
    tvUrl,
    startAtParam,
    stripElectronUserAgent: value.stripElectronUserAgent === true,
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
  const scriptHosts = hostList(value.scriptHosts, "scriptHosts");
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

function hostList(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
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
