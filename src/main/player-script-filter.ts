import type { Session, WebFrameMain, WebRequestFilter } from "electron";

type RequestType = NonNullable<WebRequestFilter["types"]>[number];
/** Any embedded player: its frame origin and the script rules it opted into. */
export interface EmbeddedPlayer {
  origin: string;
  scriptHosts?: readonly string[];
  blockedScriptPaths?: readonly string[];
  blockedRequestHosts?: readonly string[];
}

/**
 * Scripts allowed for one player frame. With an allowlist: exactly its own host (subdomains such as
 * an analytics host are not implied), plus configured hosts and their subdomains. Blocked paths on
 * the player's own host are refused either way.
 */
interface PlayerScriptPolicy {
  origin: string;
  playerHost: string;
  hosts?: readonly string[];
  blockedPaths: readonly string[];
  /** Hosts (and subdomains) refused for any request type, e.g. analytics beacons. */
  blockedHosts: readonly string[];
}

/** Minimal frame shape used to find whether a request comes from inside a player frame. */
export interface FrameLike {
  origin: string;
  parent: FrameLike | null;
}

/**
 * Policies for the configured players (anime and More) that opted in with `scriptHosts`,
 * `blockedScriptPaths` or `blockedRequestHosts`. Players with none are left untouched.
 */
export function playerScriptPolicies(players: readonly EmbeddedPlayer[]): PlayerScriptPolicy[] {
  return players.flatMap((player) =>
    player.scriptHosts || player.blockedScriptPaths || player.blockedRequestHosts
      ? [
          {
            origin: player.origin,
            playerHost: new URL(player.origin).hostname,
            ...(player.scriptHosts ? { hosts: player.scriptHosts } : {}),
            blockedPaths: player.blockedScriptPaths ?? [],
            blockedHosts: player.blockedRequestHosts ?? [],
          },
        ]
      : [],
  );
}

/**
 * The policy governing a request, if it comes from a player frame or any frame nested inside one
 * (ad frames included). The app's own main frame is never a player frame.
 */
export function policyForFrame(
  frame: FrameLike | null | undefined,
  policies: readonly PlayerScriptPolicy[],
): PlayerScriptPolicy | undefined {
  for (let current = frame; current?.parent; current = current.parent) {
    const policy = policies.find((candidate) => candidate.origin === current!.origin);
    if (policy) return policy;
  }
  return undefined;
}

export function isAllowedScript(url: string, policy: PlayerScriptPolicy): boolean {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return !policy.hosts;
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
  } catch {
    return false;
  }
  if (isBlockedHost(host, policy)) return false;
  if (host === policy.playerHost && policy.blockedPaths.includes(path)) return false;
  if (!policy.hosts) return true;
  return (
    host === policy.playerHost ||
    policy.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  );
}

/** Any request (pixel, beacon, fetch) to a host the player's policy refuses outright. */
export function isBlockedRequest(url: string, policy: PlayerScriptPolicy): boolean {
  try {
    return isBlockedHost(new URL(url).hostname.toLowerCase(), policy);
  } catch {
    return false;
  }
}

function isBlockedHost(host: string, policy: PlayerScriptPolicy): boolean {
  return policy.blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Request types a tracker beacon can use; checked only when some player blocks request hosts. */
const BEACON_TYPES: readonly RequestType[] = ["image", "ping", "xhr"];

/**
 * Blocks scripts in opted-in player frames (anime and More) unless they come from an allowed host,
 * and always blocks configured ad-library paths on the player's own host. AniStream's principles
 * are no ads and no third-party trackers: this keeps players' ad scripts (one swallowed every click
 * until an ad popup opened, which AniStream denies) and analytics beacons from loading. Hosts in
 * `blockedRequestHosts` are refused for beacons too, since an allowed player script can still
 * send pixels or `sendBeacon` pings to a tracker. Main-process only; it never changes requests
 * from the app itself or from players without rules.
 */
export function installPlayerScriptFilter(
  session: Session,
  players: readonly EmbeddedPlayer[],
): void {
  const policies = playerScriptPolicies(players);
  if (!policies.length) return;
  // Electron keeps one onBeforeRequest listener per session, so beacons share this one. `types`
  // keeps media, images and XHRs off the main thread unless a player blocks request hosts.
  const blocksBeacons = policies.some((policy) => policy.blockedHosts.length > 0);
  const types: RequestType[] = ["script", ...(blocksBeacons ? BEACON_TYPES : [])];
  session.webRequest.onBeforeRequest({ urls: ["*://*/*"], types }, (details, callback) => {
    const script = details.resourceType === "script";
    if (!script && !(blocksBeacons && BEACON_TYPES.includes(details.resourceType as RequestType))) {
      callback({});
      return;
    }
    let frame: WebFrameMain | null | undefined;
    try {
      frame = details.frame;
    } catch {
      frame = undefined;
    }
    const policy = policyForFrame(frame, policies);
    const blocked =
      policy &&
      (script ? !isAllowedScript(details.url, policy) : isBlockedRequest(details.url, policy));
    callback(blocked ? { cancel: true } : {});
  });
}
