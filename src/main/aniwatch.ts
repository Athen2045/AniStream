import type {
  AnimeEpisodeCatalog,
  AnimeEpisodeCatalogInput,
  AnimePlaybackCandidate,
  AnimePlaybackInput,
  AnimePlaybackResult,
  AnimeProviderEpisode,
} from "../shared/contracts";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import type { StreamUrlBroker } from "./hls-proxy";

const DEFAULT_BASE_URL = "https://aniwatch-api-v1-0.onrender.com";
const REQUEST_TIMEOUT_MS = 8_000;
const CATALOG_TTL_MS = 10 * 60_000;

type Fetcher = typeof fetch;

interface CachedCatalog {
  expiresAt: number;
  value: AnimeEpisodeCatalog;
}

interface SearchCandidate {
  id: string;
  names: string[];
  displayName: string;
}

interface ServerCandidate {
  id: string;
  name: string;
  audio: "sub" | "dub";
}

export class AniwatchApiClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 12,
    windowMs: 60_000,
  });
  private readonly catalogCache = new Map<string, CachedCatalog>();
  private readonly baseUrl: URL;

  public constructor(
    private readonly broker: StreamUrlBroker,
    private readonly fetcher: Fetcher = fetch,
    baseUrl = process.env.ANISTREAM_ANIWATCH_API_URL ?? DEFAULT_BASE_URL,
  ) {
    this.baseUrl = requireApiBaseUrl(baseUrl);
  }

  public async getEpisodeCatalog(input: AnimeEpisodeCatalogInput): Promise<AnimeEpisodeCatalog> {
    if (!isValidCatalogInput(input)) throw new Error("Invalid anime episode catalog request.");
    const cacheKey = `${input.aniListId}:${input.titles.map(normalizeTitle).join("|")}`;
    const cached = this.catalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const match = await this.findTitle(input.titles);
    if (!match) {
      return {
        status: "unavailable",
        provider: "aniwatch",
        seasons: [],
        message:
          "Aniwatch did not return one unique exact title match. Playback mapping was not guessed.",
        checkedAt: new Date().toISOString(),
      };
    }

    const payload = await this.requestJson(
      `/api/episode/${encodeURIComponent(match.id)}`,
      `episodes:${match.id}`,
    );
    const episodes = parseEpisodePayload(payload);
    const value: AnimeEpisodeCatalog =
      episodes.length > 0
        ? {
            status: "available",
            provider: "aniwatch",
            providerTitle: match.displayName,
            seasons: [
              {
                id: match.id,
                number: 1,
                title: input.seasonLabel?.trim() || "Season 1",
                episodes: input.totalEpisodes
                  ? episodes.filter((episode) => episode.number <= input.totalEpisodes!)
                  : episodes,
              },
            ],
            checkedAt: new Date().toISOString(),
          }
        : {
            status: "unavailable",
            provider: "aniwatch",
            providerTitle: match.displayName,
            seasons: [],
            message: "Aniwatch returned no valid episodes for this title.",
            checkedAt: new Date().toISOString(),
          };
    this.catalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_TTL_MS, value });
    return value;
  }

  public async getPlayback(input: AnimePlaybackInput): Promise<AnimePlaybackResult> {
    if (!isValidPlaybackInput(input)) throw new Error("Invalid anime playback request.");
    let episodeToken = normalizeEpisodeToken(input.providerEpisodeId);
    if (!episodeToken) {
      const catalog = await this.getEpisodeCatalog({
        aniListId: input.aniListId,
        titles: [input.title],
      });
      const providerEpisodeId = catalog.seasons
        .flatMap((season) => season.episodes)
        .find((episode) => episode.number === input.episode)?.id;
      episodeToken = normalizeEpisodeToken(providerEpisodeId);
    }
    if (!episodeToken) {
      return unavailable("Aniwatch could not map this episode to a provider episode.");
    }

    const serverPayload = await this.requestJson(
      `/api/server/${encodeURIComponent(episodeToken)}`,
      `servers:${episodeToken}`,
    );
    const servers = parseServerPayload(serverPayload);
    const preferredAudio = input.audio ?? "sub";
    const ordered = servers.sort((left, right) => {
      const audioDifference =
        Number(left.audio !== preferredAudio) - Number(right.audio !== preferredAudio);
      if (audioDifference !== 0) return audioDifference;
      return serverPriority(left.name) - serverPriority(right.name);
    });

    const results = await Promise.allSettled(
      ordered.slice(0, 4).map(async (server) => {
        const payload = await this.requestJson(
          `/api/src-server/${encodeURIComponent(server.id)}`,
          `source:${server.id}`,
        );
        return parseSourcePayload(payload, server, this.broker);
      }),
    );
    const candidates = uniquePlaybackCandidates(
      results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    );
    return candidates.length
      ? {
          status: "available",
          candidates,
          attemptedSources: ["aniwatch"],
        }
      : unavailable("Aniwatch returned hosters but no valid HTTPS HLS variants.");
  }

  private async findTitle(titles: string[]): Promise<SearchCandidate | undefined> {
    const normalizedTitles = new Set(titles.map(normalizeTitle).filter(Boolean));
    const queries = [...new Set(titles.map((title) => title.trim()).filter(Boolean))].slice(0, 3);
    for (const query of queries) {
      const payload = await this.requestJson(
        `/api/search/${encodeURIComponent(query)}/1`,
        `search:${normalizeTitle(query)}`,
      );
      const exact = parseSearchPayload(payload).filter((candidate) =>
        candidate.names.some((name) => normalizedTitles.has(normalizeTitle(name))),
      );
      const unique = [...new Map(exact.map((candidate) => [candidate.id, candidate])).values()];
      if (unique.length === 1) return unique[0];
    }
    return undefined;
  }

  private async requestJson(path: string, deduplicationKey: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    return this.requestGate.run(deduplicationKey, async () => {
      const response = await this.fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "AniStream/0.1.0 (personal macOS app)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status === 403) {
        this.requestGate.reportRateLimited(5 * 60_000);
        throw new Error(`Aniwatch temporarily refused requests (${response.status}).`);
      }
      if (!response.ok) throw new Error(`Aniwatch request failed (${response.status}).`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLocaleLowerCase().includes("json")) {
        throw new Error("Aniwatch returned an unexpected non-JSON response.");
      }
      return response.json();
    });
  }
}

export function parseSearchPayload(payload: unknown): SearchCandidate[] {
  if (!isRecord(payload)) return [];
  const raw = Array.isArray(payload.searchYour) ? payload.searchYour : [];
  return raw.flatMap((value): SearchCandidate[] => {
    if (!isRecord(value)) return [];
    const id = readString(value, ["idanime", "id", "animeId"]);
    const name = readString(value, ["name", "title"]);
    const japaneseName = readString(value, ["jname", "japanese"]);
    if (!id || !name || !isProviderId(id)) return [];
    return [{ id, names: [name, japaneseName].filter(isString), displayName: name }];
  });
}

export function parseEpisodePayload(payload: unknown): AnimeProviderEpisode[] {
  if (!isRecord(payload) || !Array.isArray(payload.episodetown)) return [];
  const episodes = payload.episodetown.flatMap((value): AnimeProviderEpisode[] => {
    if (!isRecord(value)) return [];
    const id = readString(value, ["epId", "id"]);
    const number = toPositiveInteger(value.order ?? value.number);
    if (!id || !number || !normalizeEpisodeToken(id)) return [];
    return [
      {
        id,
        number,
        title: readString(value, ["name", "title"]),
        thumbnailUrl: readHttpsUrl(value, ["image", "thumbnail", "thumbnailUrl"]),
      },
    ];
  });
  return [...new Map(episodes.map((episode) => [episode.number, episode])).values()].sort(
    (left, right) => left.number - right.number,
  );
}

export function parseServerPayload(payload: unknown): ServerCandidate[] {
  if (!isRecord(payload)) return [];
  return (["sub", "dub"] as const).flatMap((audio) => {
    const servers = payload[audio];
    if (!Array.isArray(servers)) return [];
    return servers.flatMap((value): ServerCandidate[] => {
      if (!isRecord(value)) return [];
      const id = readString(value, ["srcId", "id"]);
      const name = readString(value, ["server", "name"]);
      if (!id || !name || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) return [];
      return [{ id, name, audio }];
    });
  });
}

export function parseSourcePayload(
  payload: unknown,
  server: ServerCandidate,
  broker: StreamUrlBroker,
): AnimePlaybackCandidate[] {
  if (!isRecord(payload)) return [];
  const serverSources = Array.isArray(payload.serverSrc) ? payload.serverSrc : [];
  const sourceContainers = [
    ...serverSources,
    payload.restres,
    payload.result,
    payload.data,
    payload,
  ].filter(isRecord);

  const subtitles = sourceContainers
    .flatMap((container) => (Array.isArray(container.tracks) ? container.tracks : []))
    .flatMap((track) => {
      if (!isRecord(track)) return [];
      const url = readHttpsUrl(track, ["file", "url", "src"]);
      const kind = readString(track, ["kind", "type"])?.toLocaleLowerCase();
      if (!url || (kind && !["captions", "subtitles", "subtitle"].includes(kind))) return [];
      return [
        {
          label: readString(track, ["label", "name"]) ?? "Subtitle",
          language: readString(track, ["srclang", "language", "lang"]),
          url: broker.createUrl(url),
        },
      ];
    });

  const candidates: AnimePlaybackCandidate[] = [];
  for (const container of sourceContainers) {
    const referer = readHttpsUrl(container, ["serverlinkAni", "referer"]);
    const arrays = [container.rest, container.sources].filter(Array.isArray);
    for (const source of arrays.flat()) {
      if (!isRecord(source)) continue;
      const url = readHttpsUrl(source, ["file", "url", "src"]);
      const type = readString(source, ["type", "format"])?.toLocaleLowerCase();
      if (!url || (type !== "hls" && !/\.m3u8(?:$|\?)/i.test(url))) continue;
      candidates.push({
        id: `aniwatch:${server.audio}:${server.id}:${simpleHash(url)}`,
        label: `${server.name} · ${server.audio.toUpperCase()}`,
        kind: "hls",
        url: broker.createUrl(url, referer ? { Referer: referer } : {}),
        quality: readString(source, ["label", "quality"]),
        language: server.audio,
        provider: "aniwatch",
        subtitles,
      });
    }
  }
  return candidates;
}

function unavailable(message: string): AnimePlaybackResult {
  return {
    status: "unavailable",
    candidates: [],
    attemptedSources: ["aniwatch"],
    message,
  };
}

function normalizeEpisodeToken(value?: string): string | undefined {
  if (!value || value.length > 240) return undefined;
  const match = /(?:^|[?&])ep=(\d{1,12})(?:&|$)/.exec(value);
  if (match?.[1]) return `ep=${match[1]}`;
  if (/^\d{1,12}$/.test(value)) return `ep=${value}`;
  return undefined;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function uniquePlaybackCandidates(candidates: AnimePlaybackCandidate[]): AnimePlaybackCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()].slice(
    0,
    12,
  );
}

function serverPriority(name: string): number {
  const normalized = name.toLocaleLowerCase();
  if (normalized.includes("megacloud")) return 0;
  if (normalized.includes("vidstream")) return 1;
  return 2;
}

function requireApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLocalhost(url)) {
    throw new Error("Aniwatch API must use HTTPS unless it is hosted on localhost.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  url.search = "";
  url.hash = "";
  return url;
}

function isLocalhost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isValidCatalogInput(input: AnimeEpisodeCatalogInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    Array.isArray(input.titles) &&
    input.titles.length > 0 &&
    input.titles.length <= 8 &&
    input.titles.every((title) => title.trim().length > 0 && title.length <= 240)
  );
}

function isValidPlaybackInput(input: AnimePlaybackInput): boolean {
  return (
    Number.isInteger(input.aniListId) &&
    input.aniListId > 0 &&
    Number.isInteger(input.episode) &&
    input.episode > 0 &&
    input.title.trim().length > 0 &&
    input.title.length <= 240
  );
}

function readString(value: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const candidate = value[field];
    if (
      (typeof candidate === "string" || typeof candidate === "number") &&
      String(candidate).trim()
    ) {
      return String(candidate).trim();
    }
  }
  return undefined;
}

function readHttpsUrl(value: Record<string, unknown>, fields: string[]): string | undefined {
  const candidate = readString(value, fields);
  if (!candidate || candidate.length > 8_000) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isProviderId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,220}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function simpleHash(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}
