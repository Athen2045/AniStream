import { isPrivateAddress } from "./private-address";

/**
 * Rewrites every URI in an HLS playlist (segments, child playlists, keys, audio/subtitle renditions)
 * through `wrap`, resolved against the playlist's own URL, so the player only ever talks to the
 * trusted stream proxy.
 */
export function rewriteHlsManifest(
  manifest: string,
  manifestUrl: string,
  wrap: (url: string) => string,
): string {
  const baseUrl = requireHttpsUrl(manifestUrl);
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith("#")) return wrap(new URL(trimmed, baseUrl).toString());
      return line.replace(/URI="([^"]+)"/g, (_match, value: string) => {
        return `URI="${wrap(new URL(value, baseUrl).toString())}"`;
      });
    })
    .join("\n");
}

/** An HTTPS URL on a public host; loopback, private and link-local addresses are refused. */
export function requireHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS playback URLs are accepted.");
  if (url.username || url.password) throw new Error("Playback URLs may not carry credentials.");
  if (isPrivateHost(url.hostname)) throw new Error("Playback URLs must be on a public host.");
  return url;
}

/** Local names and private address literals; names that resolve privately are caught at fetch. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  return isPrivateAddress(host);
}
