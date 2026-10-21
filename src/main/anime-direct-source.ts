import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import type { AnimeDirectSubtitle } from "../shared/contracts";
import { assToVtt } from "./ass-to-vtt";
import type { DirectMatchStore } from "./direct-match-store";
import type { AnimeDirectHlsProvider } from "./provider-config";
import { PROVIDER_USER_AGENT, ProviderTransport } from "./provider-transport";

/**
 * Direct-stream anime source for AniStream's own player (approved trial fallback, 2026-10-18).
 * Endpoints come only from the gitignored provider config. Pages embed their data as JSON inside
 * Alpine.js `x-data` attributes; nothing is decrypted and no access protection is bypassed.
 *
 * Identity: the source exposes no AniList/MAL ID, so its title search only finds candidates. A
 * candidate is accepted only when its format class, start year and episode count agree with
 * AniList AND its first episode aired within a month of AniList's start date (online premieres run
 * up to a few weeks ahead of TV: JJK 2020-09-19 vs 2020-10-03), and exactly one
 * candidate passes. Title similarity alone never decides.
 *
 * The source's data follows AniDB (dates, counts, titles), so AniDB's own facts for the same entry
 * (from ani.zip's exact AniList-ID mapping) are a second chance for the year, count and first air
 * date: Cowboy Bebop's AniDB episode 1 is 1998-10-24 while AniList starts at 1998-04-03.
 * Measured 2026-10-21 on 189 titles: 163 matched, none wrong (docs/research).
 */
const REQUEST_TIMEOUT_MS = 15_000;
/** How long a request may wait for the rate gate before it counts as failed. */
const QUEUE_TIMEOUT_MS = 120_000;
// No published limit; conservative application policy.
const REQUESTS_PER_MINUTE = 20;
const REFUSED_PAUSE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** Typesetting-heavy scripts run to a few MB; anything larger is not a subtitle file. */
const MAX_SUBTITLE_CHARS = 8_000_000;
/** Year, format and exact episode count must already agree; this only absorbs early premieres. */
const AIR_DATE_SLACK_DAYS = 31;
/** AniDB's date is the source's own reference, so it must agree almost exactly. */
const ANIDB_AIR_DATE_SLACK_DAYS = 2;
/** A title page lists this many episodes before paging, so a full page says nothing about the end. */
const EPISODES_PER_PAGE = 24;
const MAX_SEARCHES = 7;
/** Title pieces that only name a season; searched alone they match unrelated shows. */
const SEASON_MARKER = /^(?:(?:season|part|cour)\s*\d+|\d+(?:st|nd|rd|th)\s+season|final season)$/i;

export interface DirectSearchItem {
  slug: string;
  titles: string[];
  type?: string;
  startYear?: number;
  episodeCount?: number;
  ongoing: boolean;
}

export interface DirectEpisode {
  number: number;
  title?: string;
  summary?: string;
  airDate?: string;
  durationSeconds?: number;
}

export interface DirectSubtitle {
  label: string;
  language: string;
  format: string;
  url: string;
  default: boolean;
}

export interface DirectStream {
  src: string;
  subtitles: DirectSubtitle[];
  /** Font files the subtitles use (HTTPS), when the source provides them. */
  fonts: string[];
}

/** What matching needs to know about the AniList entry. */
export interface DirectMatchTarget {
  titles: string[];
  format?: string;
  /** `YYYY-MM-DD`; partial dates cannot be matched. */
  startDate?: string;
  /** AniList's total, or the aired count while airing. */
  episodes?: number;
  /** AniList's planned total while airing, when announced. */
  plannedEpisodes?: number;
  airing: boolean;
  /** AniDB's facts for the same entry (exact AniList-ID mapping), when known. */
  aniDb?: { titles: string[]; firstAirDate?: string; episodeCount?: number };
}

export class AnimeDirectSource {
  private readonly gate: RequestGate = createRequestGate({
    requestsPerMinute: REQUESTS_PER_MINUTE,
    windowMs: 60_000,
  });
  private readonly transport: ProviderTransport;
  private readonly matches = createBoundedCache<string>({ maxEntries: 200, ttlMs: 24 * 3_600_000 });
  // A miss can be a momentary empty search page, so it is retried after half an hour.
  private readonly misses = createBoundedCache<true>({ maxEntries: 200, ttlMs: 30 * 60_000 });
  private store?: DirectMatchStore;

  public constructor(
    private readonly config: AnimeDirectHlsProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.transport = new ProviderTransport({
      gate: this.gate,
      fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      // One match runs several searches back to back; waiting for the gate is not a timeout.
      queueTimeoutMs: QUEUE_TIMEOUT_MS,
      headers: { Accept: "text/html", "User-Agent": PROVIDER_USER_AGENT },
    });
  }

  /** Keeps matches across launches (the database opens after the source is created). */
  public useMatchStore(store: DirectMatchStore): void {
    this.store = store;
  }

  /** Headers the stream proxy may add for this source's media (config opt-in only). */
  public mediaHeaders(): Record<string, string> {
    return this.config.referer ? { Referer: this.config.referer } : {};
  }

  /** The source's series slug for an AniList entry, or undefined when no single match passes. */
  public async match(aniListId: number, target: DirectMatchTarget): Promise<string | undefined> {
    const key = String(aniListId);
    const cached = this.matches.get(key);
    if (cached) return cached;
    const stored = this.store?.get(aniListId, this.now());
    if (stored && !stored.stale) {
      this.matches.set(key, stored.slug);
      return stored.slug;
    }
    if (this.misses.get(key) && !stored) return undefined;
    const slug = await matchDirectSeries(target, {
      search: (query) => this.search(query),
      episodes: (candidate) => this.episodes(candidate),
    }).catch((reason: unknown) => {
      // A failed re-check of a stored match keeps the stored one; a first lookup still fails.
      if (stored) return undefined;
      throw reason;
    });
    if (slug) {
      this.matches.set(key, slug);
      this.store?.save(aniListId, slug, this.now());
      return slug;
    }
    // A re-check that finds nothing may be a momentary empty search: keep the stored match.
    if (stored) {
      this.matches.set(key, stored.slug);
      return stored.slug;
    }
    this.misses.set(key, true);
    return undefined;
  }

  public async search(query: string): Promise<DirectSearchItem[]> {
    const html = await this.page(fill(this.config.searchUrl, { query }), `search:${query}`);
    return parseDirectSearch(html);
  }

  public async episodes(slug: string): Promise<DirectEpisode[]> {
    const html = await this.page(fill(this.config.titleUrl, { slug }), `title:${slug}`);
    return parseDirectEpisodes(html);
  }

  public async stream(slug: string, episode: number): Promise<DirectStream | undefined> {
    const html = await this.page(
      fill(this.config.episodeUrl, { slug, episode: String(episode) }),
      `episode:${slug}:${episode}`,
    );
    return parseDirectStream(html);
  }

  /** One subtitle file: ASS/SSA kept for the ASS renderer (plus a WebVTT copy), else WebVTT. */
  public async subtitle(url: string): Promise<AnimeDirectSubtitle> {
    const text = await this.transport.requestParsed(
      requireHttps(url),
      { dedupeKey: `subtitle:${url}`, onResponse: this.refuseOnBlock },
      (response) => {
        if (!response.ok) throw new Error(`Subtitle request failed (${response.status}).`);
        return response.text();
      },
    );
    return parseSubtitleText(text);
  }

  /**
   * A media playlist (to measure a stream's length). Served by the video CDN, not the source's
   * pages, so it skips the page rate gate; bounded size and time.
   */
  public async mediaText(url: string): Promise<string> {
    const response = await this.fetcher(requireHttps(url).toString(), {
      headers: { "User-Agent": PROVIDER_USER_AGENT, ...this.mediaHeaders() },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Playlist request failed (${response.status}).`);
    const text = await response.text();
    if (text.length > 4_000_000) throw new Error("Playlist too large.");
    return text;
  }

  private page(url: string, key: string): Promise<string> {
    return this.transport.requestParsed(
      requireHttps(url),
      { dedupeKey: `direct:${key}`, onResponse: this.refuseOnBlock },
      (response) => {
        if (!response.ok) throw new Error(`Direct source request failed (${response.status}).`);
        return response.text();
      },
    );
  }

  private readonly refuseOnBlock = (response: Response, gate: RequestGate): void => {
    if (response.status === 429 || response.status === 403) {
      gate.reportRateLimited(REFUSED_PAUSE_MS);
      throw new Error(`The direct source refused requests (${response.status}).`);
    }
  };
}

/** A subtitle file's text as the player wants it: ASS kept (with a WebVTT copy), else WebVTT. */
export function parseSubtitleText(text: string): AnimeDirectSubtitle {
  // trimStart also drops a byte-order mark.
  if (text.trimStart().startsWith("WEBVTT")) return { format: "vtt", text, vtt: text };
  if (/\[script info\]|\[events\]/i.test(text))
    return { format: "ass", text: text.slice(0, MAX_SUBTITLE_CHARS), vtt: assToVtt(text) };
  // SRT: same cues with comma milliseconds.
  const vtt = `WEBVTT\n\n${text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
  return { format: "vtt", text: vtt, vtt };
}

export async function matchDirectSeries(
  target: DirectMatchTarget,
  source: {
    search: (query: string) => Promise<DirectSearchItem[]>;
    episodes: (slug: string) => Promise<DirectEpisode[]>;
  },
): Promise<string | undefined> {
  if (!target.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(target.startDate)) return undefined;
  const confirmed: string[] = [];
  const seen = new Set<string>();
  for (const query of searchQueries([...target.titles, ...(target.aniDb?.titles ?? [])])) {
    for (const item of await source.search(query)) {
      if (seen.has(item.slug)) continue;
      seen.add(item.slug);
      if (await confirms(item, target, source)) confirmed.push(item.slug);
    }
    // Something passed every check: stop searching (later terms are only broader).
    if (confirmed.length) break;
  }
  return confirmed.length === 1 ? confirmed[0] : undefined;
}

/** Year, format, episode count and first air date, against AniList or AniDB's facts. */
async function confirms(
  item: DirectSearchItem,
  target: DirectMatchTarget,
  source: { episodes: (slug: string) => Promise<DirectEpisode[]> },
): Promise<boolean> {
  // Early premieres can fall in the previous year (Shield Hero: 2018-12-27 vs AniList 2019).
  const years = [target.startDate, target.aniDb?.firstAirDate].flatMap((date) =>
    date ? [Number(date.slice(0, 4))] : [],
  );
  if (item.startYear === undefined || !years.includes(item.startYear)) return false;
  const wanted = formatClass(target.format);
  if (wanted && item.type && formatClass(item.type) !== wanted) return false;
  const count = cardCount(item.episodeCount, target);
  if (count === "no") return false;
  const episodes = await source.episodes(item.slug);
  const airMs = dayMs(episodes.find((episode) => episode.number === 1)?.airDate);
  if (airMs === undefined) return false;
  if (
    !within(airMs, dayMs(target.startDate), AIR_DATE_SLACK_DAYS) &&
    !within(airMs, dayMs(target.aniDb?.firstAirDate), ANIDB_AIR_DATE_SLACK_DAYS)
  )
    return false;
  if (count === "check-listed") {
    // The card shows the planned total; the title page lists only aired episodes. A full page is
    // paged, so it cannot show where the list ends.
    if (episodes.length >= EPISODES_PER_PAGE) return false;
    const listed = Math.max(0, ...episodes.map((episode) => episode.number));
    if (!episodesAgree(listed, target)) return false;
  }
  return true;
}

/**
 * Finished: the card's count equals AniList's total or AniDB's. Airing: the card may already show
 * the planned total (12 while 3 have aired), which is then confirmed against the listed episodes.
 */
function cardCount(
  count: number | undefined,
  target: DirectMatchTarget,
): "ok" | "check-listed" | "no" {
  if (count === undefined || target.episodes === undefined) return "no";
  if (!target.airing)
    return count === target.episodes || count === target.aniDb?.episodeCount ? "ok" : "no";
  if (episodesAgree(count, target)) return "ok";
  const planned = target.plannedEpisodes;
  return count > target.episodes && (planned === undefined || count <= planned)
    ? "check-listed"
    : "no";
}

function episodesAgree(count: number, target: DirectMatchTarget): boolean {
  if (target.episodes === undefined) return false;
  // While airing, the source may list a few episodes ahead of (or behind) AniList's aired count;
  // long runners get 1% of their length. The first-air-date check still has to pass.
  const slack = Math.max(3, Math.round(target.episodes * 0.01));
  return target.airing ? Math.abs(count - target.episodes) <= slack : count === target.episodes;
}

function within(ms: number, reference: number | undefined, days: number): boolean {
  return reference !== undefined && Math.abs(ms - reference) <= days * DAY_MS;
}

function dayMs(date: string | undefined): number | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return undefined;
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Search terms only (never identity). The source matches phrases against its stored titles, so
 * punctuation matters both ways ("Naruto: Shippuuden" finds nothing, "Chitose-kun" needs its
 * hyphen): the full titles, then their pieces split at ":", " - ", "(" or "–", then the name
 * without season/part markers (punctuation kept, then removed).
 */
export function searchQueries(titles: readonly string[]): string[] {
  const out: string[] = [];
  const add = (query: string) => {
    const value = query.replace(/\s{2,}/g, " ").trim();
    if (value.length >= 3 && !out.some((known) => known.toLowerCase() === value.toLowerCase()))
      out.push(value);
  };
  const named = titles.map((title) => title.trim()).filter(Boolean);
  for (const title of named) add(title);
  for (const title of named) {
    const pieces = title
      .split(/\s*[:–—([]\s*|\s+-\s*|\s*-\s+|^-|-$/)
      .map((piece) => piece.replace(/[)\]-]+$/g, "").trim());
    if (pieces.filter(Boolean).length < 2) continue;
    // A bare "Season 2" or "2nd Season" would match unrelated shows.
    for (const piece of pieces) if (!SEASON_MARKER.test(piece)) add(piece);
  }
  for (const title of named) {
    const base = title
      .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, "")
      .replace(/\b(season|part|cour)\s+\d+\b/gi, "")
      .replace(/\s*[:\-–]\s*$/, "")
      .trim();
    if (base === title) continue;
    add(base);
    add(base.replace(/[^\p{L}\p{N}' ]+/gu, " "));
  }
  return out.slice(0, MAX_SEARCHES);
}

function formatClass(format: string | undefined): string | undefined {
  const value = format?.toUpperCase().replace(/[^A-Z]/g, "");
  if (!value) return undefined;
  if (value.includes("MOVIE")) return "movie";
  if (value === "OVA" || value === "OAD" || value.includes("SPECIAL")) return "special";
  // The source labels ONAs "Web".
  if (value === "TV" || value === "TVSHORT" || value === "ONA" || value === "WEB") return "series";
  if (value.startsWith("TV")) return "series";
  return undefined;
}

/** Alpine `x-data` JSON lives in a single-quoted JS string with `"`-style escapes. */
function embeddedJson(html: string, pattern: RegExp): unknown {
  const match = html.match(pattern);
  if (!match) return undefined;
  const raw = match[1]
    .replace(/\\u0022/g, '"')
    .replace(/\\{3}\//g, "/")
    .replace(/\\\\u/g, "\\u")
    .replace(/\\'/g, "'");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

const ITEMS_PATTERN = /items:\s*JSON\.parse\('(.*?)'\)\s*,/s;

export function parseDirectSearch(html: string): DirectSearchItem[] {
  const items = embeddedJson(html, ITEMS_PATTERN);
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): DirectSearchItem[] => {
    if (!isRecord(item) || typeof item.slug !== "string" || !/^[a-z0-9]{4,32}$/i.test(item.slug))
      return [];
    const titleList = isRecord(item.title_list) ? Object.values(item.title_list) : [];
    return [
      {
        slug: item.slug,
        titles: [item.main_title, ...titleList]
          .filter((title): title is string => typeof title === "string" && title.trim() !== "")
          .slice(0, 20),
        type: typeof item.type === "string" ? item.type : undefined,
        startYear: positiveInt(item.start_year),
        episodeCount: positiveInt(item.episode_count),
        ongoing: item.is_ongoing === true,
      },
    ];
  });
}

export function parseDirectEpisodes(html: string): DirectEpisode[] {
  const items = embeddedJson(html, ITEMS_PATTERN);
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): DirectEpisode[] => {
    if (!isRecord(item)) return [];
    const number = Number(item.slug);
    if (!Number.isInteger(number) || number < 1 || number > 5_000) return [];
    const titles = isRecord(item.title_list) ? item.title_list : {};
    const title = [titles["1"], titles["5"]].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    return [
      {
        number,
        ...(title ? { title: title.replace(/`/g, "’").trim() } : {}),
        ...(typeof item.summary === "string" && item.summary.trim()
          ? { summary: item.summary.replace(/`/g, "’").trim().slice(0, 1_200) }
          : {}),
        ...(typeof item.air_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(item.air_date)
          ? { airDate: item.air_date.slice(0, 10) }
          : {}),
        ...(positiveInt(item.duration) ? { durationSeconds: positiveInt(item.duration) } : {}),
      },
    ];
  });
}

export function parseDirectStream(html: string): DirectStream | undefined {
  const data = embeddedJson(html, /vidstackPlayer\(JSON\.parse\('(.*?)'\)\)/s);
  if (!isRecord(data) || typeof data.src !== "string") return undefined;
  let src: string;
  try {
    src = requireHttps(data.src).toString();
  } catch {
    return undefined;
  }
  const subtitles = (Array.isArray(data.subtitles) ? data.subtitles : []).flatMap(
    (track): DirectSubtitle[] => {
      if (!isRecord(track) || typeof track.file !== "string") return [];
      try {
        const url = requireHttps(track.file).toString();
        const language = typeof track.language === "string" ? track.language.slice(0, 16) : "und";
        return [
          {
            url,
            language,
            label:
              typeof track.title === "string" && track.title.trim()
                ? track.title.trim().slice(0, 60)
                : language,
            format: typeof track.format === "string" ? track.format.toLowerCase() : "ass",
            default: track.default === true,
          },
        ];
      } catch {
        return [];
      }
    },
  );
  const fonts = (Array.isArray(data.fonts) ? data.fonts : []).flatMap((font): string[] => {
    const file =
      typeof font === "string" ? font : isRecord(font) ? (font.file ?? font.url) : undefined;
    if (typeof file !== "string") return [];
    try {
      return [requireHttps(file).toString()];
    } catch {
      return [];
    }
  });
  return { src, subtitles: subtitles.slice(0, 40), fonts: fonts.slice(0, 60) };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );
}

function requireHttps(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username) throw new Error("Only HTTPS URLs are accepted.");
  return url;
}

function positiveInt(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
