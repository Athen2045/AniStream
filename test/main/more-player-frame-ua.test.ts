import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import type { WebContents } from "electron";
import { describe, expect, it } from "vitest";
import {
  frameFullscreenBridgeScript,
  frameStubScript,
  iframeUserAgent,
  MorePlayerFrameUserAgent,
  stripElectronToken,
} from "../../src/main/more-player-frame-ua";

const TRUTHFUL =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.129 Electron/43.2.0 Safari/537.36";
const STRIPPED =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.129 Safari/537.36";

describe("More player frame User-Agent", () => {
  it("removes only the Electron token", () => {
    expect(stripElectronToken(TRUTHFUL)).toBe(STRIPPED);
    expect(stripElectronToken(STRIPPED)).toBe(STRIPPED);
  });

  it("strips the UA for the player origin and restores it for every other iframe", () => {
    const choose = (url: string | undefined) =>
      iframeUserAgent({
        url,
        playerOrigin: "https://more.example",
        truthful: TRUTHFUL,
        stripped: STRIPPED,
      });

    expect(choose("https://more.example/tv/1/1/1?autoPlay=true")).toBe(STRIPPED);
    // Unknown until navigation commits; the target is re-evaluated once its origin is known.
    expect(choose(undefined)).toBe(STRIPPED);
    expect(choose("https://player.example/a/1/1/sub")).toBe(TRUTHFUL);
    expect(choose("https://more.example.attacker.example/")).toBe(TRUTHFUL);
    expect(choose("http://more.example/")).toBe(TRUTHFUL);
    expect(choose("not a url")).toBe(TRUTHFUL);
  });
});

function fakeContents() {
  const commands: Array<{ method: string; params: unknown; sessionId?: string }> = [];
  let attached = false;
  const debug = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: () => {
      attached = true;
    },
    detach: () => {
      attached = false;
    },
    sendCommand: async (method: string, params: unknown, sessionId?: string) => {
      commands.push({ method, params, sessionId });
      return {};
    },
  });
  const contents = {
    debugger: debug,
    isDestroyed: () => false,
    getUserAgent: () => TRUTHFUL,
  } as unknown as WebContents;
  const emit = (method: string, params: Record<string, unknown>) =>
    debug.emit("message", {}, method, params);
  const overrides = () =>
    commands.filter((command) => command.method === "Emulation.setUserAgentOverride");
  return { contents, emit, overrides, commands };
}

const STRIP_ONLY = { playerOrigin: "https://more.example", stripUserAgent: true, stubGlobals: [] };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("More player frame override session", () => {
  it("does not re-send an unchanged UA while the player frame navigates", async () => {
    const { contents, emit, overrides } = fakeContents();
    const frameUa = new MorePlayerFrameUserAgent(contents);
    await frameUa.arm(STRIP_ONLY);
    const targetInfo = { targetId: "frame-1", type: "iframe", url: "" };
    emit("Target.attachedToTarget", { sessionId: "s-1", targetInfo });
    await flush();
    for (const path of ["/movie/1", "/movie/1?x=1", "/movie/1#player"])
      emit("Target.targetInfoChanged", {
        targetInfo: { ...targetInfo, url: `https://more.example${path}` },
      });
    await flush();
    expect(overrides()).toEqual([
      {
        method: "Emulation.setUserAgentOverride",
        params: { userAgent: STRIPPED },
        sessionId: "s-1",
      },
    ]);
  });

  it("restores the truthful UA once when a frame turns out to be another origin", async () => {
    const { contents, emit, overrides } = fakeContents();
    const frameUa = new MorePlayerFrameUserAgent(contents);
    await frameUa.arm(STRIP_ONLY);
    const targetInfo = { targetId: "ad-1", type: "iframe", url: "" };
    emit("Target.attachedToTarget", { sessionId: "s-2", targetInfo });
    await flush();
    emit("Target.targetInfoChanged", {
      targetInfo: { ...targetInfo, url: "https://ads.example/a" },
    });
    emit("Target.targetInfoChanged", {
      targetInfo: { ...targetInfo, url: "https://ads.example/b" },
    });
    await flush();
    expect(
      overrides().map((command) => (command.params as { userAgent: string }).userAgent),
    ).toEqual([STRIPPED, TRUTHFUL]);
  });

  it("injects the stub script into new frames without touching the UA when not asked to", async () => {
    const { contents, emit, commands } = fakeContents();
    const frameUa = new MorePlayerFrameUserAgent(contents);
    await frameUa.arm({
      playerOrigin: "https://player.example",
      stripUserAgent: false,
      stubGlobals: ["adlib"],
    });
    const targetInfo = { targetId: "frame-3", type: "iframe", url: "" };
    emit("Target.attachedToTarget", { sessionId: "s-3", targetInfo });
    await flush();
    emit("Target.targetInfoChanged", {
      targetInfo: { ...targetInfo, url: "https://player.example/v2/x" },
    });
    await flush();
    const sent = commands.filter((command) => command.sessionId === "s-3");
    expect(sent.map((command) => command.method)).toEqual([
      "Page.enable",
      "Page.addScriptToEvaluateOnNewDocument",
      "Runtime.runIfWaitingForDebugger",
    ]);
    expect(sent[1]!.params).toMatchObject({ runImmediately: true });
  });
});

describe("frame stub script", () => {
  const run = (origin: string, page: string) => {
    const window: Record<string, unknown> = {};
    runInNewContext(frameStubScript("https://player.example", ["adlib"]), {
      window,
      location: { origin },
      Object,
      Proxy,
    });
    return runInNewContext(page, { window, ...window }, {}) as unknown;
  };

  it("turns the named global into an inert stub that ignores reassignment", () => {
    const window: Record<string, unknown> = {};
    runInNewContext(frameStubScript("https://player.example", ["adlib"]), {
      window,
      location: { origin: "https://player.example" },
      Object,
      Proxy,
    });
    window.adlib = { runPop: () => "popped" };
    const stub = window.adlib as { runPop: (zone: unknown) => unknown };
    expect(stub.runPop({ zoneId: "1" })).toBeUndefined();
    expect((stub as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it("leaves frames of any other origin alone", () => {
    expect(run("https://other.example", "typeof window.adlib")).toBe("undefined");
  });
});

describe("frame fullscreen bridge", () => {
  const load = (origin: string, isTop = false) => {
    const posted: unknown[] = [];
    const events: string[] = [];
    let onMessage: ((event: { source: unknown; data: unknown }) => void) | undefined;
    class Element {
      dispatchEvent(event: { type: string }) {
        events.push(event.type);
      }
    }
    Object.assign(Element.prototype, { requestFullscreen: () => "native" });
    class Document {
      dispatchEvent(event: { type: string }) {
        events.push(event.type);
      }
    }
    Object.assign(Document.prototype, { exitFullscreen: () => "native" });
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const document = Object.assign(new Document(), { documentElement: new Element() });
    const window: Record<string, unknown> = {
      parent,
      addEventListener: (_type: string, handler: typeof onMessage) => {
        onMessage = handler;
      },
    };
    window.top = isTop ? window : {};
    runInNewContext(frameFullscreenBridgeScript(["https://player.example"]), {
      window,
      document,
      location: { origin },
      Element,
      Document,
      Event: class {
        constructor(public type: string) {}
      },
      Object,
      Promise,
    });
    const element = new Element() as Element & { requestFullscreen(): unknown };
    const state = (value: boolean, source: unknown = parent) =>
      onMessage?.({ source, data: { anistreamFullscreenState: value } });
    const fullscreenElement = () =>
      (document as unknown as { fullscreenElement: unknown }).fullscreenElement;
    return {
      window,
      posted,
      events,
      element,
      document: document as unknown as { exitFullscreen(): unknown },
      state,
      fullscreenElement,
    };
  };

  it("forwards a player frame's fullscreen calls to AniStream instead of entering itself", async () => {
    const { posted, element, document } = load("https://player.example");
    await element.requestFullscreen();
    await document.exitFullscreen();
    expect(posted).toEqual([{ anistreamFullscreen: "request" }, { anistreamFullscreen: "exit" }]);
  });

  it("mirrors AniStream's fullscreen state so the player sees its own element as fullscreen", async () => {
    const { element, events, state, fullscreenElement } = load("https://player.example");
    await element.requestFullscreen();
    expect(fullscreenElement()).toBeNull();
    state(true, {});
    expect(fullscreenElement()).toBeNull(); // only the parent may report the state
    state(true);
    expect(fullscreenElement()).toBe(element);
    state(false);
    expect(fullscreenElement()).toBeNull();
    expect(events).toEqual([
      "fullscreenchange",
      "webkitfullscreenchange",
      "fullscreenchange",
      "webkitfullscreenchange",
    ]);
  });

  it("makes window.open return nothing in every embedded frame, without opening anything", () => {
    for (const origin of ["https://player.example", "https://ads.example"]) {
      const loaded = load(origin);
      expect((loaded.window.open as () => unknown)()).toBeNull();
    }
    expect(load("https://player.example", true).window.open).toBeUndefined();
  });

  it("leaves other origins and the top window alone", () => {
    const other = load("https://ads.example");
    expect(other.element.requestFullscreen()).toBe("native");
    const top = load("https://player.example", true);
    expect(top.element.requestFullscreen()).toBe("native");
    expect(other.posted).toEqual([]);
  });
});

describe("fullscreen bridge attachment", () => {
  it("stays attached with the bridge after disarm and injects it into every new frame", async () => {
    const { contents, emit, commands } = fakeContents();
    const hook = new MorePlayerFrameUserAgent(contents, ["https://player.example"]);
    await hook.start();
    hook.disarm();
    emit("Target.attachedToTarget", {
      sessionId: "s-9",
      targetInfo: { targetId: "f-9", type: "iframe", url: "" },
    });
    await flush();
    const sent = commands.filter((command) => command.sessionId === "s-9");
    expect(sent.map((command) => command.method)).toEqual([
      "Page.enable",
      "Page.addScriptToEvaluateOnNewDocument",
      "Runtime.runIfWaitingForDebugger",
    ]);
    expect((sent[1]!.params as { source: string }).source).toContain("anistreamFullscreen");
  });
});
