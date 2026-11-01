/**
 * Wrong-video detection for More players (user report 2026-10-29): a player can map a TMDB id to
 * another show (one served the anime One Piece for the live-action series and the other way
 * round, 25 min against 64 min). The length the player reports is compared with TMDB's runtime.
 *
 * TMDB runtimes are whole minutes and streaming cuts differ a little from them, so only a gross
 * difference counts: more than 30 % of the expected length and at least 5 minutes.
 */
const MIN_DIFFERENCE_SECONDS = 5 * 60;
const MAX_DIFFERENCE_SHARE = 0.3;

export function isWrongMoreVideo(
  actualSeconds: number | undefined,
  expectedMinutes: number | undefined,
): boolean {
  if (!actualSeconds || !Number.isFinite(actualSeconds) || actualSeconds <= 0) return false;
  if (!expectedMinutes || !Number.isFinite(expectedMinutes) || expectedMinutes <= 0) return false;
  const expected = expectedMinutes * 60;
  const difference = Math.abs(actualSeconds - expected);
  return difference >= MIN_DIFFERENCE_SECONDS && difference > expected * MAX_DIFFERENCE_SHARE;
}
