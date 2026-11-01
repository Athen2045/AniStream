const MORE_PLAYER_FEATURES = ["autoplay", "encrypted-media", "fullscreen", "picture-in-picture"];

/**
 * The More player frame's permissions policy. A bare feature covers only the `src` origin, so a
 * player whose embed URL redirects (`frameOrigin`, a validated https origin) would lose fullscreen
 * and autoplay there; its frame origin is listed too.
 */
export function morePlayerAllow(frameOrigin: string | undefined): string {
  return MORE_PLAYER_FEATURES.map((feature) =>
    frameOrigin ? `${feature} 'src' ${frameOrigin}` : feature,
  ).join("; ");
}
