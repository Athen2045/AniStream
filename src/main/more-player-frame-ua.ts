import type { WebContents } from "electron";

/**
 * The configured More player rejects requests whose User-Agent carries Electron's
 * `Electron/x.y.z` token. The user approved presenting the same Chromium UA without that token,
 * scoped to the More player frame only.
 */
export function stripElectronToken(userAgent: string): string {
  return userAgent.replace(/\sElectron\/\S+/g, "");
}

/**
 * Chooses the UA for a cross-site iframe target. A new iframe has no URL when it attaches, so it
 * starts with the stripped UA while More playback is armed; once its origin is known, anything
 * other than the configured More player is returned to the truthful UA.
 */
export function iframeUserAgent(input: {
  url: string | undefined;
  playerOrigin: string;
  truthful: string;
  stripped: string;
}): string {
  if (!input.url) return input.stripped;
  return safeOrigin(input.url) === input.playerOrigin ? input.stripped : input.truthful;
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/**
 * Applies the stripped UA to the More player iframe inside the AniStream window. Electron's
 * per-window and per-session UA settings do not reach cross-site (out-of-process) iframes, so this
 * uses the Chromium DevTools protocol on the window's own iframe targets. It is armed only while a
 * More title is opening/playing: new targets pause until their UA is set, every other target is
 * resumed untouched, and non-player iframes are reverted as soon as their origin is known. The
 * main frame, the anime player, and all other requests keep the truthful UA. Main-process only.
 */
export class MorePlayerFrameUserAgent {
  private armed = false;
  private playerOrigin = "";
  /** Per iframe target: its flattened session and the UA last applied to it. */
  private readonly sessions = new Map<string, { sessionId: string; userAgent: string }>();
  private readonly truthful: string;
  private readonly stripped: string;
  private readonly onMessage = (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ): void => {
    if (method === "Target.attachedToTarget") void this.attached(params);
    else if (method === "Target.targetInfoChanged") void this.changed(params);
    else if (method === "Target.detachedFromTarget" && typeof params.targetId === "string")
      this.sessions.delete(params.targetId);
  };

  constructor(private readonly contents: WebContents) {
    this.truthful = contents.getUserAgent();
    this.stripped = stripElectronToken(this.truthful);
  }

  /** Idempotent. Call before the More player iframe is created, with that player's origin. */
  async arm(playerOrigin: string): Promise<void> {
    this.playerOrigin = playerOrigin;
    if (this.armed || this.contents.isDestroyed()) return;
    const debug = this.contents.debugger;
    if (!debug.isAttached()) debug.attach("1.3");
    debug.on("message", this.onMessage);
    this.armed = true;
    await debug.sendCommand("Target.setDiscoverTargets", { discover: true });
    await debug.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }

  /** Idempotent. The current player frame keeps its UA until it is removed. */
  disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    this.sessions.clear();
    if (this.contents.isDestroyed()) return;
    const debug = this.contents.debugger;
    debug.removeListener("message", this.onMessage);
    if (debug.isAttached()) debug.detach();
  }

  private async attached(params: Record<string, unknown>): Promise<void> {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
    const info = params.targetInfo as TargetInfo | undefined;
    if (!sessionId || !info) return;
    const debug = this.contents.debugger;
    try {
      if (info.type === "iframe") {
        const userAgent = this.userAgentFor(info.url);
        this.sessions.set(info.targetId, { sessionId, userAgent });
        await debug.sendCommand("Emulation.setUserAgentOverride", { userAgent }, sessionId);
      }
    } catch {
      // A target that closed before configuration needs no override.
    } finally {
      await debug.sendCommand("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    }
  }

  private async changed(params: Record<string, unknown>): Promise<void> {
    const info = params.targetInfo as TargetInfo | undefined;
    if (!info || info.type !== "iframe" || !info.url) return;
    const session = this.sessions.get(info.targetId);
    if (!session) return;
    const userAgent = this.userAgentFor(info.url);
    // targetInfoChanged fires repeatedly while a frame navigates. Re-sending an unchanged override
    // mid-navigation crashed Electron's main process natively (reproduced 2026-10-03 on Windows),
    // so only send when the frame actually needs a different UA.
    if (userAgent === session.userAgent) return;
    session.userAgent = userAgent;
    await this.contents.debugger
      .sendCommand("Emulation.setUserAgentOverride", { userAgent }, session.sessionId)
      .catch(() => {});
  }

  private userAgentFor(url: string): string {
    return iframeUserAgent({
      url: url || undefined,
      playerOrigin: this.playerOrigin,
      truthful: this.truthful,
      stripped: this.stripped,
    });
  }
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
