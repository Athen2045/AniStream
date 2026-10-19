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

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))
    return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
