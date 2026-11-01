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

/**
 * Script run in every iframe the window creates while armed, before that document's own scripts.
 * It acts only on the configured player's origin: each named global becomes an inert stub that
 * ignores assignments, so an ad library the page writes inline (no URL to block) never installs
 * its click handlers and every click reaches the player's controls. Nothing is reported to the ad
 * network; its code simply does not run. Names are validated identifiers (provider-config).
 */
export function frameStubScript(playerOrigin: string, names: readonly string[]): string {
  return `(() => {
  if (location.origin !== ${JSON.stringify(playerOrigin)}) return;
  const noop = () => undefined;
  const inert = new Proxy(noop, { get: (_t, key) => (key === "then" ? undefined : inert), apply: noop });
  for (const name of ${JSON.stringify(names)}) {
    try {
      Object.defineProperty(window, name, { configurable: false, get: () => inert, set: noop });
    } catch {}
  }
})();`;
}

/**
 * Script run in the configured player frames (anime and More) before their own scripts. A frame
 * that requests fullscreen itself takes Chromium about six seconds to switch (measured 2026-10-30
 * with a bare cross-origin page, so not the players' doing), and by then the click no longer
 * counts as a gesture, so AniStream could not move fullscreen to its player view and the viewer
 * dropped back to a window. The player's fullscreen calls are instead forwarded to AniStream
 * (`{ anistreamFullscreen: "request" | "exit" }` to the parent), which makes its whole player view
 * fullscreen at once while the click still counts. Origins are validated https origins.
 */
export function frameFullscreenBridgeScript(origins: readonly string[]): string {
  return `(() => {
  if (window === window.top) return;
  // The main process refuses every new window, but a refused window.open still uses up the click's
  // user activation, so the player's next step (its fullscreen request) failed on the first click.
  // In every embedded frame it now returns no window without touching the click.
  try { Object.defineProperty(window, "open", { configurable: true, writable: true, value: function open() { return null; } }); } catch {}
  if (!${JSON.stringify(origins)}.includes(location.origin)) return;
  let active = false;
  let element = null;
  const send = (action) => { try { window.parent.postMessage({ anistreamFullscreen: action }, "*"); } catch {} };
  const define = (proto, name, descriptor) => {
    if (proto && name in proto) Object.defineProperty(proto, name, { configurable: true, ...descriptor });
  };
  const request = function () { element = this; send("request"); return Promise.resolve(); };
  for (const name of ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"]) define(Element.prototype, name, { writable: true, value: request });
  define(window.HTMLVideoElement && HTMLVideoElement.prototype, "webkitEnterFullscreen", { writable: true, value: request });
  const exit = function () { send("exit"); return Promise.resolve(); };
  for (const name of ["exitFullscreen", "webkitExitFullscreen", "webkitCancelFullScreen"]) define(Document.prototype, name, { writable: true, value: exit });
  // The player sees AniStream's fullscreen as its own, so its button and icon stay in step.
  const current = () => (active ? element || document.documentElement : null);
  for (const name of ["fullscreenElement", "webkitFullscreenElement", "webkitCurrentFullScreenElement"]) define(Document.prototype, name, { get: current });
  define(Document.prototype, "webkitIsFullScreen", { get: () => active });
  // AniStream focuses the player frame when it starts (Space and arrows go to the player), but
  // some players (JW Player) only listen on their own box, not the page: with nothing focused
  // inside, keys did nothing. The outermost focusable box around the video takes focus then.
  const playerBox = () => {
    let box = null;
    for (let node = document.querySelector("video"); node && node !== document.body; node = node.parentElement)
      if (node.tabIndex >= 0) box = node;
    return box;
  };
  const focusPlayer = () => {
    if (!document.hasFocus() || (document.activeElement && document.activeElement !== document.body)) return true;
    const box = playerBox();
    if (box) box.focus({ preventScroll: true });
    return Boolean(box);
  };
  let tries = 0;
  const keepTrying = () => { if (!focusPlayer() && ++tries < 20) setTimeout(keepTrying, 500); };
  window.addEventListener("focus", () => { tries = 0; keepTrying(); });
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || typeof event.data.anistreamFullscreenState !== "boolean") return;
    const next = event.data.anistreamFullscreenState;
    if (next === active) return;
    const target = current() || document;
    active = next;
    if (!active) element = null;
    for (const type of ["fullscreenchange", "webkitfullscreenchange"]) target.dispatchEvent(new Event(type, { bubbles: true }));
  });
})();`;
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
  private stripUserAgent = false;
  private stubScript: string | undefined;
  private readonly bridgeScript: string | undefined;
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

  /**
   * `bridgeOrigins`: every configured player frame origin. With any, the hook stays attached for
   * the window's life (`start`) so each player frame gets the fullscreen bridge; the per-player
   * UA override and stubs still apply only while armed.
   */
  constructor(
    private readonly contents: WebContents,
    bridgeOrigins: readonly string[] = [],
    /** Ad globals stubbed in these players' frames for the window's life (anime players). */
    permanentStubs: readonly { origin: string; names: readonly string[] }[] = [],
  ) {
    this.truthful = contents.getUserAgent();
    this.stripped = stripElectronToken(this.truthful);
    this.bridgeScript =
      bridgeOrigins.length > 0
        ? [
            frameFullscreenBridgeScript(bridgeOrigins),
            ...permanentStubs.map((stub) => frameStubScript(stub.origin, stub.names)),
          ].join("\n")
        : undefined;
  }

  /** Idempotent. Attaches for the fullscreen bridge; also after a reload or renderer crash. */
  async start(): Promise<void> {
    if (!this.bridgeScript) return;
    await this.attach();
  }

  /**
   * Idempotent. Call before the More player iframe is created, with the origin its document runs
   * on, whether its frame gets the stripped UA, and the globals to stub there (may be empty).
   */
  async arm(options: {
    playerOrigin: string;
    stripUserAgent: boolean;
    stubGlobals: readonly string[];
  }): Promise<void> {
    this.playerOrigin = options.playerOrigin;
    this.stripUserAgent = options.stripUserAgent;
    this.stubScript =
      options.stubGlobals.length > 0
        ? frameStubScript(options.playerOrigin, options.stubGlobals)
        : undefined;
    await this.attach();
  }

  private async attach(): Promise<void> {
    if (this.contents.isDestroyed()) return;
    const debug = this.contents.debugger;
    if (this.armed && debug.isAttached()) return;
    if (!debug.isAttached()) debug.attach("1.3");
    debug.removeListener("message", this.onMessage);
    debug.on("message", this.onMessage);
    this.armed = true;
    await debug.sendCommand("Target.setDiscoverTargets", { discover: true });
    await debug.sendCommand("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }

  /**
   * Idempotent. Ends the per-player UA override and stubs; the current player frame keeps its UA
   * until it is removed. With the fullscreen bridge the hook stays attached (see `dispose`).
   */
  disarm(): void {
    const hadPlayer = this.playerOrigin !== "";
    this.playerOrigin = "";
    this.stripUserAgent = false;
    this.stubScript = undefined;
    if (!this.bridgeScript) return this.dispose();
    // Staying attached while a frame with the UA override is torn down crashed Electron's main
    // process natively (reproduced 2026-10-30 switching players every 2 s), so a player's session
    // ends with a full detach, as before the bridge; the bridge re-attaches at once.
    if (hadPlayer) {
      this.dispose();
      void this.start().catch(() => undefined);
    }
  }

  /** Detaches completely (window closing). */
  dispose(): void {
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
        const source = [this.bridgeScript, this.stubScript].filter(Boolean).join("\n");
        if (source) {
          // Without the Page domain enabled the script is accepted but never runs (seen live).
          await debug.sendCommand("Page.enable", {}, sessionId);
          await debug.sendCommand(
            "Page.addScriptToEvaluateOnNewDocument",
            { source, runImmediately: true },
            sessionId,
          );
        }
        if (this.stripUserAgent)
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
    if (!this.stripUserAgent || userAgent === session.userAgent) return;
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
