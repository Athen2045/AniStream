import { describe, expect, it, vi } from "vitest";
import { installPlayerScriptFilter } from "../../src/main/player-script-filter";
import { isAppSchemeUrl, isForeignSchemeFrame } from "../../src/main/scheme-access";

vi.mock("electron", () => ({ net: { request: vi.fn() }, protocol: { handle: vi.fn() } }));
const { StreamProxy } = await import("../../src/main/stream-proxy");

const APP = "http://127.0.0.1:41728";
const top = { origin: APP, parent: null };
const player = { origin: "https://more-player.example", parent: top };

describe("isForeignSchemeFrame", () => {
  it("lets the app's top-level page and the main process through", () => {
    expect(isForeignSchemeFrame(top, APP)).toBe(false);
    expect(isForeignSchemeFrame(undefined, APP)).toBe(false);
  });

  it("refuses player frames, frames inside them and same-origin nested frames", () => {
    expect(isForeignSchemeFrame(player, APP)).toBe(true);
    expect(isForeignSchemeFrame({ origin: "https://ads.example", parent: player }, APP)).toBe(true);
    expect(isForeignSchemeFrame({ origin: APP, parent: top }, APP)).toBe(true);
    expect(isForeignSchemeFrame({ origin: "http://127.0.0.1:41729", parent: null }, APP)).toBe(
      true,
    );
  });

  it("knows the app's schemes", () => {
    expect(isAppSchemeUrl("anistream-media://offline/a/b")).toBe(true);
    expect(isAppSchemeUrl("anistream-art://image/?src=x")).toBe(true);
    expect(isAppSchemeUrl("https://anistream-media.example/")).toBe(false);
  });
});

describe("request filter guards the app's schemes", () => {
  type Listener = (details: object, callback: (response: object) => void) => void;
  const install = (appOrigin?: string) => {
    let filter: { urls: string[]; types?: string[] } | undefined;
    let listener: Listener | undefined;
    installPlayerScriptFilter(
      {
        webRequest: {
          onBeforeRequest: (f: typeof filter, l: Listener) => {
            filter = f;
            listener = l;
          },
        },
      } as never,
      [],
      appOrigin,
    );
    const decide = (url: string, frame: object | undefined, resourceType = "xhr") =>
      new Promise<object>((resolve) => listener!({ url, frame, resourceType }, resolve));
    return { filter: () => filter, decide };
  };

  it("cancels a player frame's request and lets the app's own through", async () => {
    const { filter, decide } = install(APP);
    expect(filter()?.urls).toContain("anistream-media://*/*");
    expect(filter()?.types).toBeUndefined();
    await expect(decide("anistream-media://offline/a/b.m3u8", player)).resolves.toEqual({
      cancel: true,
    });
    await expect(decide("anistream-art://image/?src=x", player, "image")).resolves.toEqual({
      cancel: true,
    });
    await expect(decide("anistream-media://offline/a/b.m3u8", top)).resolves.toEqual({});
    // Ordinary web requests are not touched by the scheme guard.
    await expect(decide("https://cdn.example/a.jpg", player, "image")).resolves.toEqual({});
  });

  it("installs nothing when there are neither player rules nor an app origin", () => {
    expect(install().filter()).toBeUndefined();
  });
});

describe("StreamProxy CORS", () => {
  it("names only the app's origin, never every origin", async () => {
    const proxy = new StreamProxy(vi.fn() as unknown as typeof fetch, async () => [
      "93.184.216.34",
    ]);
    proxy.setAppOrigin(APP);
    proxy.setOfflineFiles(() => undefined);
    const response = await proxy.handle(new Request("anistream-media://offline/id/master.m3u8"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });
});
