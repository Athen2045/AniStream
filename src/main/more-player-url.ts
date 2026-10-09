import type { MoreMediaType } from "../shared/contracts";
import { fillUrlTemplate, type MorePlayerConfig } from "./provider-config";

/** Builds a More player URL from the local provider config and a validated TMDB identity. */
export function buildMorePlayerUrl(
  config: MorePlayerConfig,
  input: {
    tmdbId: number;
    type: MoreMediaType;
    season?: number;
    episode?: number;
    startAtSeconds?: number;
  },
): string {
  if (!Number.isInteger(input.tmdbId) || input.tmdbId <= 0)
    throw new Error("Invalid TMDB media ID.");
  let filled: string;
  if (input.type === "TV") {
    if (
      !Number.isInteger(input.season) ||
      !Number.isInteger(input.episode) ||
      input.season! < 1 ||
      input.episode! < 1
    ) {
      throw new Error("A TV season and episode are required for More playback.");
    }
    filled = fillUrlTemplate(config.tvUrl, {
      tmdbId: input.tmdbId,
      season: input.season!,
      episode: input.episode!,
    });
  } else {
    filled = fillUrlTemplate(config.movieUrl, { tmdbId: input.tmdbId });
  }
  const url = new URL(filled);
  if (url.origin !== config.origin) throw new Error("More player URL left its configured origin.");
  const startAt = Math.floor(input.startAtSeconds ?? 0);
  if (config.startAtParam && Number.isFinite(startAt) && startAt > 0)
    url.searchParams.set(config.startAtParam, String(startAt));
  return url.toString();
}
