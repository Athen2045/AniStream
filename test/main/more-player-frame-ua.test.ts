import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it } from "vitest";
import {
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
  return { contents, emit, overrides };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("More player frame override session", () => {
  it("does not re-send an unchanged UA while the player frame navigates", async () => {
    const { contents, emit, overrides } = fakeContents();
    const frameUa = new MorePlayerFrameUserAgent(contents);
    await frameUa.arm("https://more.example");
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
    await frameUa.arm("https://more.example");
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
});
