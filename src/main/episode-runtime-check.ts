import type { AnimeDirectRuntimeCheck } from "../shared/contracts";

/**
 * Mislabel detection for the direct-stream source (user request 2026-10-18): a source page can link
 * the wrong video (its One Piece "episode 1" served the 23:20 ONE PIECE HEROINES special), so the
 * stream's real length is compared with the expected runtime.
 *
 * AniList's \`duration\` is one average per series (One Piece: 24 min) and real episodes already vary
 * around it (23.6–26 min), so it only catches gross mixups. TheTVDB's per-episode runtime (via
 * ani.zip) is precise enough to catch a different video of similar length: genuine episodes were
 * within 0–1.0 min of it, the mislabel 1.66 min off (measured 2026-10-18).
 */

/** Per-episode runtimes are whole minutes, so allow rounding plus normal variation. */
const EPISODE_SLACK_SECONDS = 75;
const EPISODE_SLACK_SHARE = 0.05;
/** The series average only flags gross mixups (a film or a short instead of an episode). */
const SERIES_SLACK_SHARE = 0.25;

export function checkEpisodeRuntime(input: {
  actualSeconds: number | undefined;
  /** This episode's runtime in minutes (TheTVDB via ani.zip). */
  episodeMinutes?: number;
  /** AniList's average episode length in minutes. */
  seriesMinutes?: number;
}): AnimeDirectRuntimeCheck | undefined {
  const actual = input.actualSeconds;
  if (!actual || !Number.isFinite(actual) || actual <= 0) return undefined;
  if (input.episodeMinutes && input.episodeMinutes > 0) {
    const expected = input.episodeMinutes * 60;
    const slack = Math.max(EPISODE_SLACK_SECONDS, expected * EPISODE_SLACK_SHARE);
    return {
      actualSeconds: Math.round(actual),
      expectedSeconds: expected,
      basis: "episode",
      mismatch: Math.abs(actual - expected) > slack,
    };
  }
  if (input.seriesMinutes && input.seriesMinutes > 0) {
    const expected = input.seriesMinutes * 60;
    return {
      actualSeconds: Math.round(actual),
      expectedSeconds: expected,
      basis: "series",
      mismatch: Math.abs(actual - expected) > expected * SERIES_SLACK_SHARE,
    };
  }
  return undefined;
}

/** Total length of a media playlist: the sum of its segment durations. */
export function playlistSeconds(playlist: string): number {
  let total = 0;
  for (const match of playlist.matchAll(/^#EXTINF:\s*([\d.]+)/gm)) total += Number(match[1]);
  return total;
}

/**
 * A stream's length from its HLS playlists: a master playlist is followed to its first variant
 * (every variant of one video has the same length). Undefined when it cannot be measured.
 */
export async function measureHlsSeconds(
  masterUrl: string,
  fetchText: (url: string) => Promise<string>,
): Promise<number | undefined> {
  const master = await fetchText(masterUrl);
  if (/#EXTINF/.test(master)) return playlistSeconds(master) || undefined;
  const lines = master.split(/\r?\n/);
  const variantIndex = lines.findIndex((line) => line.startsWith("#EXT-X-STREAM-INF"));
  const variant = lines
    .slice(variantIndex + 1)
    .find((line) => line.trim() && !line.startsWith("#"));
  if (variantIndex < 0 || !variant) return undefined;
  const seconds = playlistSeconds(await fetchText(new URL(variant.trim(), masterUrl).toString()));
  return seconds || undefined;
}
