import type {
  AnimePlaybackCandidate,
  AnimePlaybackInput,
  AnimePlaybackResult,
} from "../shared/contracts";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const NYAA_RSS_URL = "https://nyaa.si/";
const ANIME_TOSHO_JSON_URL = "https://feed.animetosho.org/json";
const REQUEST_TIMEOUT_MS = 20_000;

type Fetcher = typeof fetch;

/**
 * Approved torrent indexer fallback. It only discovers magnet URIs; starting
 * a torrent remains an explicit operating-system action by the user.
 */
export class AnimeTorrentSourceClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 6,
    windowMs: 60_000,
  });

  public constructor(private readonly fetcher: Fetcher = fetch) {}

  public async getPlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult> {
    if (!isValidPlaybackInput(input)) throw new Error("Invalid anime playback request.");
    const query = `${input.title} ${String(input.episode).padStart(2, "0")}`;
    const results = await Promise.allSettled([
      this.searchNyaa(query),
      this.searchAnimeTosho(query),
    ]);
    const candidates = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    const unique = uniqueCandidates(candidates).sort(
      (left, right) => (right.seeders ?? 0) - (left.seeders ?? 0),
    );
    return unique.length
      ? {
          status: "available",
          candidates: unique,
          attemptedSources: ["nyaa", "animetosho"],
        }
      : {
          status: "unavailable",
          candidates: [],
          attemptedSources: ["nyaa", "animetosho"],
          message: "The approved torrent indexes returned no matching release.",
        };
  }

  private async searchNyaa(query: string): Promise<AnimePlaybackCandidate[]> {
    const url = new URL(NYAA_RSS_URL);
    url.searchParams.set("page", "rss");
    url.searchParams.set("q", query);
    url.searchParams.set("c", "1_2");
    url.searchParams.set("f", "0");
    const response = await this.request(
      url,
      "application/rss+xml, application/xml;q=0.9, */*;q=0.1",
    );
    return parseNyaaRss(await response.text());
  }

  private async searchAnimeTosho(query: string): Promise<AnimePlaybackCandidate[]> {
    const url = new URL(ANIME_TOSHO_JSON_URL);
    url.searchParams.set("qx", query);
    const response = await this.request(url, "application/json");
    return parseAnimeToshoJson(await response.json());
  }

  private async request(url: URL, accept: string): Promise<Response> {
    return this.requestGate.run(url.toString(), async () => {
      const response = await this.fetcher(url, {
        headers: {
          Accept: accept,
          "User-Agent": "AniStream/0.1.0 (personal macOS app)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status === 403) {
        this.requestGate.reportRateLimited(5 * 60_000);
        throw new Error("The torrent indexer temporarily refused AniStream requests.");
      }
      if (!response.ok) throw new Error(`Torrent indexer request failed (${response.status}).`);
      return response;
    });
  }
}

export function parseNyaaRss(xml: string): AnimePlaybackCandidate[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  return items.flatMap((item): AnimePlaybackCandidate[] => {
    const title = decodeXml(readTag(item, "title"));
    const magnet = decodeXml(readTag(item, "nyaa:magneturl"));
    if (!title || !isMagnetUri(magnet)) return [];
    const seeders = toNonNegativeNumber(readTag(item, "nyaa:seeders"));
    const sizeBytes = toNonNegativeNumber(readTag(item, "nyaa:size"));
    return [
      {
        id: `nyaa:${simpleHash(magnet)}`,
        label: title,
        kind: "torrent",
        url: magnet,
        seeders,
        sizeBytes,
        quality: findQuality(title),
      },
    ];
  });
}

export function parseAnimeToshoJson(payload: unknown): AnimePlaybackCandidate[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): AnimePlaybackCandidate[] => {
    if (!isRecord(item)) return [];
    const magnet = typeof item.magnet_uri === "string" ? item.magnet_uri : undefined;
    const title = typeof item.title === "string" ? item.title : undefined;
    if (!title || !isMagnetUri(magnet)) return [];
    return [
      {
        id: `animetosho:${simpleHash(magnet)}`,
        label: title,
        kind: "torrent",
        url: magnet,
        seeders: toNonNegativeNumber(item.seeders),
        sizeBytes: toNonNegativeNumber(item.total_size),
        quality: findQuality(title),
      },
    ];
  });
}

function readTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(
    `<${escapeRegex(tag)}[^>]*>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`,
    "i",
  ).exec(xml);
  return match?.[1]?.trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(value?: string): string | undefined {
  return value
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function uniqueCandidates(candidates: AnimePlaybackCandidate[]): AnimePlaybackCandidate[] {
  const byUrl = new Map<string, AnimePlaybackCandidate>();
  for (const candidate of candidates) {
    const current = byUrl.get(candidate.url);
    if (!current || (candidate.seeders ?? 0) > (current.seeders ?? 0))
      byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()].slice(0, 20);
}

function isValidPlaybackInput(input: AnimePlaybackInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    Number.isInteger(input.episode) &&
    input.episode > 0 &&
    input.title.trim().length > 0 &&
    input.title.trim().length <= 240
  );
}

function isMagnetUri(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("magnet:?") && value.length <= 8_000;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function findQuality(title: string): string | undefined {
  return /\b(2160p|1440p|1080p|720p|480p)\b/i.exec(title)?.[1];
}

function simpleHash(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
