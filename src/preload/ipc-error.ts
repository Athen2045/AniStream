const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

/** Keep Electron channel names and provider transport wording out of user-facing errors. */
export function normalizeIpcError(reason: unknown, channel = ""): Error {
  const original = reason instanceof Error ? reason : undefined;
  const raw = original?.message ?? String(reason ?? "");
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) {
    const provider =
      /mangadex/i.test(raw) || channel.startsWith("mangadex:") ? "MangaDex" : "AniList";
    return new Error(`${provider} is busy right now. Please wait a few minutes, then try again.`);
  }

  const message = raw.replace(IPC_ERROR_PREFIX, "").trim();
  if (message !== raw) return new Error(message || "AniStream could not complete this request.");
  return original ?? new Error(message || "AniStream could not complete this request.");
}
