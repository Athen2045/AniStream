import type { KitsuHeroArtwork, KitsuHeroArtworkInput } from "../shared/contracts";
import { createBoundedCache } from "./anilist/cache";
import { createRequestGate, type RequestGate } from "./anilist/request-queue";
import { ProviderTransport } from "./provider-transport";

const KITSU_API_URL = "https://kitsu.io/api/edge";
const REQUEST_TIMEOUT_MS = 12_000;
const HERO_CACHE_TTL_MS = 30 * 60_000;
const SEARCH_LIMIT = 20;

type Fetcher = typeof fetch;

/**
 * Development-only Kitsu artwork lookup. AniList remains the source of media
 * identity and metadata; Kitsu contributes only a wide hero image after an
 * exact AniList mapping has been confirmed in the included JSON:API records.
 */
export class KitsuClient {
  private readonly requestGate: RequestGate = createRequestGate({
    requestsPerMinute: 30,
    windowMs: 60_000,
  });
  private readonly heroCache = createBoundedCache<KitsuHeroArtwork | undefined>({
    maxEntries: 80,
    ttlMs: HERO_CACHE_TTL_MS,
  });
  private readonly transport: ProviderTransport;

  public constructor(
    private readonly apiBaseUrl = KITSU_API_URL,
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.transport = new ProviderTransport({
      gate: this.requestGate,
      fetcher: this.fetcher,
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/vnd.api+json",
        "User-Agent": "AniStream/0.1.4 (development Kitsu hero preview)",
      },
    });
  }

  public async getHeroArtwork(input: KitsuHeroArtworkInput): Promise<KitsuHeroArtwork | undefined> {
    validateInput(input);
    const kind = input.type === "ANIME" ? "anime" : "manga";
    const cacheKey = `${kind}:${input.aniListId}`;
    const cached = this.heroCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const url = new URL(`${this.apiBaseUrl}/${kind}`);
    url.searchParams.set("filter[text]", input.title);
    url.searchParams.set("include", "mappings");
    url.searchParams.set("page[limit]", String(SEARCH_LIMIT));

    const payload = await this.transport.requestParsed(
      url,
      {
        dedupeKey: `kitsu-hero:${cacheKey}`,
        onResponse: (response, gate) => {
          if (response.status === 429 || response.status === 403) {
            gate.reportRateLimited(5 * 60_000);
            throw new Error(`Kitsu temporarily refused requests (${response.status}).`);
          }
        },
      },
      (response) => {
        if (!response.ok) throw new Error(`Kitsu request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      },
    );
    const artwork = parseKitsuHeroArtwork(payload, input);
    this.heroCache.set(cacheKey, artwork);
    return artwork;
  }
}

export function parseKitsuHeroArtwork(
  payload: unknown,
  input: KitsuHeroArtworkInput,
): KitsuHeroArtwork | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const included = Array.isArray(payload.included) ? payload.included : [];
  const expectedSite = input.type === "ANIME" ? "anilist/anime" : "anilist/manga";

  for (const candidate of payload.data) {
    if (!isRecord(candidate)) continue;
    const relationships = isRecord(candidate.relationships) ? candidate.relationships : undefined;
    const mappings =
      relationships && isRecord(relationships.mappings) ? relationships.mappings : undefined;
    const mappingData = mappings && Array.isArray(mappings.data) ? mappings.data : [];
    const mappingIds = new Set(
      mappingData.flatMap((mapping) =>
        isRecord(mapping) && typeof mapping.id === "string" ? [mapping.id] : [],
      ),
    );
    const hasExactMapping = included.some((mapping) => {
      if (!isRecord(mapping) || mapping.type !== "mappings" || typeof mapping.id !== "string") {
        return false;
      }
      if (!mappingIds.has(mapping.id)) return false;
      const attributes = isRecord(mapping.attributes) ? mapping.attributes : undefined;
      return (
        attributes?.externalSite === expectedSite &&
        attributes.externalId === String(input.aniListId)
      );
    });
    if (!hasExactMapping) continue;

    const attributes = isRecord(candidate.attributes) ? candidate.attributes : undefined;
    const coverImage =
      attributes && isRecord(attributes.coverImage) ? attributes.coverImage : undefined;
    const imageUrl = readHttpsUrl(coverImage?.large) ?? readHttpsUrl(coverImage?.original);
    if (!imageUrl) continue;

    const dimensions =
      coverImage && isRecord(coverImage.meta) && isRecord(coverImage.meta.dimensions)
        ? coverImage.meta.dimensions
        : undefined;
    const largeDimensions = dimensions && isRecord(dimensions.large) ? dimensions.large : undefined;
    const width = readPositiveNumber(largeDimensions?.width);
    const height = readPositiveNumber(largeDimensions?.height);
    return { source: "kitsu", imageUrl, width, height };
  }

  return undefined;
}

function validateInput(input: KitsuHeroArtworkInput): void {
  if (
    !Number.isInteger(input.aniListId) ||
    input.aniListId <= 0 ||
    (input.type !== "ANIME" && input.type !== "MANGA") ||
    input.title.trim().length === 0 ||
    input.title.length > 200
  ) {
    throw new Error("Invalid Kitsu hero-art lookup input.");
  }
}

function readHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8_000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
