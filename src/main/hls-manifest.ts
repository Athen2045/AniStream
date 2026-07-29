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

export function requireHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS playback URLs are accepted.");
  return url;
}
