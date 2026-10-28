import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireHttpsUrl } from "./hls-manifest";
import { isPrivateAddress } from "./private-address";

/**
 * Fetches for the stream proxy and the episode downloader, whose URLs come from provider data
 * (playlists, redirects). Every hop must be HTTPS to a host that resolves only to public addresses,
 * so a source cannot point the trusted process at the user's router or LAN, and no request ever
 * carries the session's cookies or credentials.
 *
 * A host is resolved here and again by the network stack, so a rebinding DNS server could still
 * answer differently in between; the check stops plain redirects and private-resolving names.
 */
export type HostLookup = (hostname: string) => Promise<string[]>;

export const systemLookup: HostLookup = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

const MAX_REDIRECTS = 5;
const VERDICT_TTL_MS = 60_000;
const MAX_VERDICTS = 256;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface PublicFetchOptions {
  fetcher: typeof fetch;
  lookup?: HostLookup;
  now?: () => number;
}

export interface PublicFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PublicFetchResult {
  response: Response;
  /** The URL that answered, after any redirects. */
  url: string;
}

/** A URL or redirect this fetch will not follow; retrying the same URL cannot succeed. */
export class UnsafeUrlError extends Error {}

/** Returns a fetch that follows redirects itself and checks each hop's host first. */
export function createPublicFetch(
  options: PublicFetchOptions,
): (url: string, init?: PublicFetchInit) => Promise<PublicFetchResult> {
  const resolveHost = options.lookup ?? systemLookup;
  const now = options.now ?? Date.now;
  // Segments come from a handful of hosts; one lookup per host a minute is enough.
  const verdicts = new Map<string, { publicHost: boolean; expiresAt: number }>();

  const isPublicHost = async (hostname: string): Promise<boolean> => {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (isIP(bare)) return !isPrivateAddress(bare);
    const cached = verdicts.get(bare);
    if (cached && cached.expiresAt > now()) return cached.publicHost;
    const addresses = await resolveHost(bare);
    const publicHost = addresses.length > 0 && !addresses.some(isPrivateAddress);
    verdicts.set(bare, { publicHost, expiresAt: now() + VERDICT_TTL_MS });
    while (verdicts.size > MAX_VERDICTS) verdicts.delete(verdicts.keys().next().value!);
    return publicHost;
  };

  return async (url, init = {}) => {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      let target: URL;
      try {
        target = requireHttpsUrl(current);
      } catch (reason) {
        throw new UnsafeUrlError(
          reason instanceof Error ? reason.message : "Invalid playback URL.",
        );
      }
      if (!(await isPublicHost(target.hostname)))
        throw new UnsafeUrlError("Playback URLs must be on a public host.");
      const response = await options.fetcher(target.toString(), {
        headers: init.headers,
        signal: init.signal,
        redirect: "manual",
        credentials: "omit",
      });
      if (response.type === "opaqueredirect" || response.status === 0) {
        throw new UnsafeUrlError("The video host sent a redirect that could not be checked.");
      }
      if (!REDIRECT_STATUSES.has(response.status)) return { response, url: target.toString() };
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new UnsafeUrlError("The video host sent a redirect without a location.");
      if (hop >= MAX_REDIRECTS)
        throw new UnsafeUrlError("The video host redirected too many times.");
      current = new URL(location, target).toString();
    }
  };
}
