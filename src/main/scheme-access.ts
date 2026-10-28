import type { FrameLike } from "./player-script-filter";

/**
 * AniStream's own schemes (`anistream-media://` streams and offline files, `anistream-art://`
 * artwork) are registered on the default session, which embedded players share. Only the app's
 * own page may load them; a player frame or an ad frame inside it is refused (audit finding 5).
 *
 * Checked in the session's request filter, the only place that knows the requesting frame:
 * Electron hands `protocol.handle` no Origin or Referer, and it does not enforce CORS on these
 * schemes (both checked 2026-10-28). Requests from workers never reach the filter; there the
 * unguessable stream tokens and download IDs are the protection.
 */
export const APP_SCHEME_PATTERNS = ["anistream-media://*/*", "anistream-art://*/*"];

export function isAppSchemeUrl(url: string): boolean {
  return url.startsWith("anistream-media:") || url.startsWith("anistream-art:");
}

/**
 * True when a frame other than the app's top-level page asked. Requests with no frame come from
 * the main process itself (or a worker, which the filter never sees) and are let through.
 */
export function isForeignSchemeFrame(
  frame: FrameLike | null | undefined,
  appOrigin: string,
): boolean {
  if (!frame) return false;
  return frame.parent !== null || frame.origin !== appOrigin;
}
