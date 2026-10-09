/**
 * AniList could not be reached or asked AniStream to back off: network failure, timeout, rate
 * limit (429), or a server error (5xx). Library edits that fail this way are queued locally and
 * sent later; any other failure (validation, auth, missing entry) is surfaced to the user.
 */
export class AniListUnavailableError extends Error {
  constructor(message = "AniList is unreachable right now.") {
    super(message);
    this.name = "AniListUnavailableError";
  }
}

export function isAniListUnavailable(error: unknown): boolean {
  return error instanceof AniListUnavailableError;
}

/** Network-level fetch failures (offline, DNS, reset) and deadline aborts. */
export function asUnavailable(error: unknown): unknown {
  if (error instanceof AniListUnavailableError) return error;
  if (error instanceof TypeError) return new AniListUnavailableError();
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return new AniListUnavailableError("AniList did not respond in time.");
  return error;
}
