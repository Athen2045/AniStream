import type {
  AnimeEpisodeCatalog,
  AnimeProviderEpisode,
  AnimeProviderSeason,
} from "../shared/contracts";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";

const DEFAULT_MIRRORS = [
  "https://zenshin-supabase-api.onrender.com",
  "https://zenshin-supabase-api-myig.onrender.com",
];
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 24 * 60 * 60_000;

type Fetcher = typeof fetch;

interface CachedCatalog {
  expiresAt: number;
  value: AnimeEpisodeCatalog;
}

export class ZenshinEpisodeClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 4,
    windowMs: 60_000,
  });
  private readonly cache = new Map<number, CachedCatalog>();
  private readonly mirrors: URL[];

  public constructor(
    private readonly fetcher: Fetcher = fetch,
    mirrors = configuredMirrors(),
  ) {
    this.mirrors = mirrors.map(requireApiBaseUrl);
  }

  public async getCatalog(aniListId: number): Promise<AnimeEpisodeCatalog> {
    if (!Number.isInteger(aniListId) || aniListId <= 0) {
      throw new Error("Invalid AniList media ID.");
    }
    const cached = this.cache.get(aniListId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const failures: string[] = [];
    for (const mirror of this.mirrors) {
      try {
        const url = new URL("/mappings", mirror);
        url.searchParams.set("anilist_id", String(aniListId));
        const response = await this.requestGate.run(url.toString(), () =>
          this.fetcher(url, {
            headers: {
              Accept: "application/json",
              "User-Agent": "AniStream/0.1.0 (personal macOS app)",
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        );
        if (response.status === 429 || response.status === 403) {
          this.requestGate.reportRateLimited(5 * 60_000);
          throw new Error(`mirror refused requests (${response.status})`);
        }
        if (!response.ok) throw new Error(`mirror failed (${response.status})`);
        const value = parseZenshinCatalog(await response.json(), aniListId);
        if (value.status !== "available") throw new Error("mirror returned no regular episodes");
        this.cache.set(aniListId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
        return value;
      } catch (reason) {
        failures.push(reason instanceof Error ? reason.message : "unknown mirror failure");
      }
    }
    return {
      status: "unavailable",
      provider: "zenshin",
      seasons: [],
      message: `Zenshin episode enrichment is unavailable. ${failures.join("; ")}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

export function parseZenshinCatalog(payload: unknown, aniListId: number): AnimeEpisodeCatalog {
  if (!isRecord(payload) || !isRecord(payload.episodes)) {
    return unavailable("Zenshin returned an invalid episode payload.");
  }
  const title = readTitle(payload.title) ?? readString(payload, ["mainTitle"]);
  const bySeason = new Map<number, AnimeProviderEpisode[]>();
  for (const [key, value] of Object.entries(payload.episodes)) {
    if (!/^\d+$/.test(key) || !isRecord(value)) continue;
    const type = readString(value, ["type"]);
    if (type && type !== "Regular Episode") continue;
    const episodeNumber =
      toPositiveInteger(value.episodeNumber) ??
      toPositiveInteger(value.episode) ??
      toPositiveInteger(key);
    if (!episodeNumber) continue;
    const seasonNumber = toPositiveInteger(value.seasonNumber) ?? 1;
    const episode: AnimeProviderEpisode = {
      id: `zenshin:${aniListId}:${key}`,
      number: episodeNumber,
      title: readTitle(value.title) ?? readString(value, ["nameTvdb"]),
      thumbnailUrl: readHttpsUrl(value, ["image"]),
      description: readString(value, ["overview"]),
      durationMinutes:
        toPositiveInteger(value.runtime) ?? parseDurationMinutes(readString(value, ["length"])),
    };
    bySeason.set(seasonNumber, [...(bySeason.get(seasonNumber) ?? []), episode]);
  }
  const seasons: AnimeProviderSeason[] = [...bySeason.entries()]
    .sort(([left], [right]) => left - right)
    .map(([seasonNumber, episodes]) => ({
      id: `zenshin:${aniListId}:season:${seasonNumber}`,
      number: seasonNumber,
      title: `Season ${seasonNumber}`,
      episodes: episodes.sort((left, right) => left.number - right.number),
    }));
  return seasons.length
    ? {
        status: "available",
        provider: "zenshin",
        providerTitle: title,
        seasons,
        checkedAt: new Date().toISOString(),
      }
    : unavailable("Zenshin returned no regular episodes.");
}

function unavailable(message: string): AnimeEpisodeCatalog {
  return {
    status: "unavailable",
    provider: "zenshin",
    seasons: [],
    message,
    checkedAt: new Date().toISOString(),
  };
}

function configuredMirrors(): string[] {
  const configured = process.env.ANISTREAM_ZENSHIN_API_URL?.trim();
  return configured ? [configured, ...DEFAULT_MIRRORS] : DEFAULT_MIRRORS;
}

function requireApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Zenshin mirrors must use HTTPS.");
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  url.search = "";
  url.hash = "";
  return url;
}

function readTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readString(value, ["en", "main", "romaji", "ja"]);
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

function parseDurationMinutes(value?: string): number | undefined {
  const match = value ? /^(\d{1,3})m$/i.exec(value.trim()) : undefined;
  return match?.[1] ? Number(match[1]) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
