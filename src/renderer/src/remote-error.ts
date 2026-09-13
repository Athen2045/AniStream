export interface FriendlyRemoteErrorOptions {
  provider: string;
  operation: string;
  retained?: boolean;
  fallback: string;
}

function rawMessage(reason: unknown): string {
  return reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
}

/** Converts transport/provider details into short recovery guidance for renderer surfaces. */
export function friendlyRemoteError(reason: unknown, options: FriendlyRemoteErrorOptions): string {
  const raw = rawMessage(reason);
  const retained = options.retained ? ` Your previous ${options.operation} remain available.` : "";

  if (/connect (?:your )?anilist|sign.?in (?:to )?anilist/i.test(raw))
    return "Connect AniList from Profile to manage your library.";
  if (/\b401\b|unauthori[sz]ed|token (?:has )?expired|invalid (?:access )?token/i.test(raw))
    return `Your ${options.provider} connection has expired. Open Profile and reconnect, then try again.`;
  if (/\b429\b|rate.?limit|too many requests|temporarily busy|paused? (?:new )?requests/i.test(raw))
    return `${options.provider} is busy right now.${retained} Try again in a few minutes.`;
  if (/timeout|timed out|timeouterror|taking longer|aborterror/i.test(raw))
    return `${options.operation[0].toUpperCase()}${options.operation.slice(1)} are taking longer than expected.${retained} Try again in a moment.`;
  if (/failed to fetch|network|offline|enotfound|econn|dns|internet/i.test(raw))
    return `Could not reach ${options.provider}.${retained} Check your connection and try again.`;
  if (
    /malformed|invalid (?:json|response|payload)|unexpected (?:response|payload)|schema/i.test(raw)
  )
    return `${options.provider} returned incomplete data.${retained} Try again shortly.`;
  if (
    /\b(?:403|500|502|503|504)\b|forbidden|service unavailable|bad gateway|upstream error/i.test(
      raw,
    )
  )
    return `${options.provider} is temporarily unavailable.${retained} Try again shortly.`;
  return options.fallback;
}

/** Hides opaque embed/provider codes while giving the viewer a useful recovery choice. */
export function friendlyPlaybackError(reason: unknown): string {
  const raw = rawMessage(reason);
  if (/timeout|timed out|timeouterror|taking longer|aborterror/i.test(raw))
    return "The player is taking longer than expected. Retry the player in a moment.";
  if (/failed to fetch|network|offline|enotfound|econn|dns|internet/i.test(raw))
    return "The player could not be reached. Check your connection and retry the player.";
  if (
    /\b(?:403|404|429|451|500|502|503|504)\b|233403|unavailable|not found|no playable|forbidden|rate.?limit/i.test(
      raw,
    )
  )
    return "This episode is unavailable from the player right now. Try another audio option or episode.";
  return "This episode could not be played. Retry the player or choose another audio option or episode.";
}
