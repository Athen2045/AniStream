import { expect, test } from "@playwright/test";
import { launchApp, waitForShell, type TestApp } from "./app";

// A stand-in player on the example More player host with an ad frame inside it, the way real
// players carry ads: each click tries an ad trick (issue 38).
const AD_PAGE = `<!doctype html><body>
<button id="popup" onclick="window.open('https://ads.example/popup', '_blank', 'noreferrer')">popup</button>
<button id="top" onclick="top.location.href = 'https://ads.example/takeover'">top</button>
</body>`;
const PLAYER_PAGE = `<!doctype html><body style="margin:0">
<iframe id="ad" src="https://ads.example/frame" style="border:0;width:100%;height:200px"></iframe>
</body>`;

test.describe("Pop-ups", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await waitForShell(session.window);
    // Record what would reach the default browser instead of opening it.
    await session.app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    await session.window.route("https://more-player.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: PLAYER_PAGE }),
    );
    await session.window.route("https://ads.example/frame", (route) =>
      route.fulfill({ contentType: "text/html", body: AD_PAGE }),
    );
  });
  test.afterAll(async () => session?.close());

  const opened = (): Promise<string[]> =>
    session.app.evaluate(() => [...((globalThis as { opened?: string[] }).opened ?? [])]);

  test("a player frame cannot open a window or send the app to another page", async () => {
    const { app, window } = session;
    const appUrl = window.url();
    await window.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "test-player";
      frame.src = "https://more-player.example/movie/1";
      frame.style.cssText = "position:fixed;inset:20% 30%;z-index:99999;background:#fff";
      document.body.append(frame);
    });
    const player = window.frameLocator("#test-player").frameLocator("#ad");
    await player.locator("#popup").click();
    await player.locator("#top").click();
    await window.waitForTimeout(500);

    expect(await opened()).toEqual([]);
    expect(app.windows()).toHaveLength(1);
    expect(window.url()).toBe(appUrl);
    await window.evaluate(() => document.getElementById("test-player")?.remove());
  });

  test("AniStream's own links still open in the browser", async () => {
    const { app, window } = session;
    await window.evaluate(() => {
      const link = document.createElement("a");
      link.id = "test-link";
      link.href = "https://anilist.co/";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "AniList";
      link.style.cssText = "position:fixed;top:40%;left:40%;z-index:99999";
      document.body.append(link);
    });
    await window.locator("#test-link").click();
    await expect.poll(opened).toEqual(["https://anilist.co/"]);
    expect(app.windows()).toHaveLength(1);
  });
});
