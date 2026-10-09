const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Decides whether the electron-vite `ELECTRON_RENDERER_URL` override may replace the built
 * renderer server. The chosen origin becomes the trusted IPC origin and receives the preload
 * bridge, so packaged builds never honor it and development accepts only a plain loopback
 * HTTP dev server. Callers must read the value before loading any `.env` file.
 */
export function resolveDevRendererUrl(input: {
  packaged: boolean;
  value: string | undefined;
}): string | undefined {
  if (input.packaged) return undefined;
  const value = input.value?.trim();
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ELECTRON_RENDERER_URL is not a valid URL.");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "ELECTRON_RENDERER_URL must be a loopback http:// development server (localhost, 127.0.0.1, or [::1]).",
    );
  }
  return url.toString();
}
