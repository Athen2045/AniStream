import type { AnimeEpisodeGuide, AnimeEpisodeGuideEpisode } from "../shared/contracts";

const PARSE_BASE_URL = "https://api.parse.bot";
const DEFAULT_SCRAPER_ID = "57fd33bc-2965-4c61-9741-68e60a184d8b";
const DEFAULT_ENDPOINT = "get_show_episodes";
const MAX_EPISODES = 500;

export async function getAnimeEpisodeGuide(slug: string): Promise<AnimeEpisodeGuide> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) throw new Error("A title is required to load episode data.");

  const apiKey = process.env.PARSE_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "unconfigured",
      slug: normalizedSlug,
      episodes: [],
      message: "Add PARSE_API_KEY to the main-process environment to load episode guides.",
      fetchedAt: new Date().toISOString(),
    };
  }

  const scraperId = process.env.PARSE_ANIME_SCRAPER_ID?.trim() || DEFAULT_SCRAPER_ID;
  const endpoint = process.env.PARSE_ANIME_EPISODES_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const url = new URL(`${PARSE_BASE_URL}/scraper/${scraperId}/${endpoint}`);
  url.searchParams.set("slug", normalizedSlug);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) throw new Error(`Parse episode guide failed (${response.status}).`);

    return {
      status: "configured",
      slug: normalizedSlug,
      episodes: normalizeEpisodes(payload),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      slug: normalizedSlug,
      episodes: [],
      message: error instanceof Error ? error.message : "Parse episode guide is unavailable.",
      fetchedAt: new Date().toISOString(),
    };
  }
}

export function normalizeEpisodes(payload: unknown): AnimeEpisodeGuideEpisode[] {
  const candidates = findEpisodeArray(payload);
  const episodes: AnimeEpisodeGuideEpisode[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates.slice(0, MAX_EPISODES)) {
    if (!isRecord(candidate)) continue;
    const number = firstFiniteNumber(
      candidate.episode,
      candidate.episode_number,
      candidate.number,
      candidate.ep,
    );
    if (number === undefined || number < 0) continue;
    const season = firstFiniteNumber(candidate.season, candidate.season_number);
    const id =
      firstString(candidate.id, candidate.episode_id, candidate.slug) ?? `${season ?? 1}-${number}`;
    const key = `${season ?? 1}:${number}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    episodes.push({
      id,
      number,
      season,
      title: firstString(candidate.title, candidate.name, candidate.episode_title),
      thumbnailUrl: firstString(candidate.thumbnail, candidate.thumbnail_url, candidate.image),
      airDate: firstString(candidate.air_date, candidate.airdate, candidate.release_date),
    });
  }

  return episodes.sort(
    (left, right) => (left.season ?? 1) - (right.season ?? 1) || left.number - right.number,
  );
}

function findEpisodeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["episodes", "results", "items", "data"]) {
    const child = value[key];
    if (Array.isArray(child)) return child;
    const nested = findEpisodeArray(child);
    if (nested.length) return nested;
  }
  return [];
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}
