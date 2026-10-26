import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";
import { stubTitles } from "./stub-titles";

const STREAM_DIR = join(import.meta.dirname, "fixtures", "stream");

/** Episode 1 of every fixture title plays a 40-second test stream in the own player. */
async function stubPlayback(app: ElectronApplication): Promise<void> {
  await stubTitles(app);
  await app.evaluate(({ ipcMain }) => {
    const played: number[] = [];
    (globalThis as { played?: number[] }).played = played;
    ipcMain.removeHandler("anime:direct-playback");
    ipcMain.removeHandler("anime:skip-times");
    // An ending from 25 to 35 seconds into the 40-second test stream.
    ipcMain.handle("anime:skip-times", () => [{ kind: "ending", start: 25, end: 35 }]);
    ipcMain.handle("anime:direct-playback", (_event, input: { episode: number }) => {
      played.push(input.episode);
      return {
        status: "ready",
        streamUrl: "https://stream.example/test/index.m3u8",
        subtitles: [],
        fonts: [],
      };
    });
  });
}

const video = (window: Page) => window.locator(".own-player video");
const currentTime = (window: Page): Promise<number> =>
  video(window).evaluate((node: HTMLVideoElement) => node.currentTime);
/** Focus is back on the player itself (the hand-back runs just after a click). */
const playerFocused = (window: Page): Promise<void> =>
  expect(window.locator(".own-player .vplayer")).toBeFocused();
const paused = (window: Page): Promise<boolean> =>
  video(window).evaluate((node: HTMLVideoElement) => node.paused);

test.describe("Own player keyboard", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubPlayback });
    await session.window.route("https://stream.example/test/*", (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop()!;
      return route.fulfill({
        contentType: file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
        body: readFileSync(join(STREAM_DIR, file)),
      });
    });
    await waitForShell(session.window);
    await openSection(session.window, "Anime");
    await session.window
      .getByRole("region", { name: "For You recommendations" })
      .getByRole("button", { name: "Watch Fixture Finished Show" })
      .click();
    await expect(video(session.window)).toBeAttached();
    await expect
      .poll(() => video(session.window).evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThan(1);
  });
  test.afterAll(async () => session?.close());

  test("shortcuts keep working after clicking the player's buttons and sliders", async () => {
    const { window } = session;
    const player = window.locator(".own-player .vplayer");
    await player.hover();

    // The player has focus as soon as it starts: Space pauses rather than pressing Back.
    await playerFocused(window);
    await expect.poll(() => paused(window)).toBe(false);
    await window.keyboard.press("Space");
    await expect.poll(() => paused(window)).toBe(true);
    await expect(window.locator(".own-player video")).toBeVisible();

    // Clicking Play leaves focus on that button: Space must pause, not press Play again.
    await player.getByRole("button", { name: /^Play$/ }).click();
    await playerFocused(window);
    await expect.poll(() => paused(window)).toBe(false);
    await window.keyboard.press("Space");
    await expect.poll(() => paused(window)).toBe(true);
    await window.keyboard.press("k");
    await expect.poll(() => paused(window)).toBe(false);
    await window.keyboard.press("Space");
    await expect.poll(() => paused(window)).toBe(true);

    // After the volume slider, the arrows seek again instead of moving the slider.
    await player.getByRole("slider", { name: /volume/i }).click();
    await playerFocused(window);
    const before = await currentTime(window);
    await window.keyboard.press("ArrowRight");
    await expect.poll(() => currentTime(window)).toBeGreaterThan(before + 5);

    // And after the 10-second back button, Space still toggles playback.
    await player.getByRole("button", { name: "Back 10 seconds" }).click();
    await playerFocused(window);
    await window.keyboard.press("Space");
    await expect.poll(() => paused(window)).toBe(false);
  });

  test("the Settings menu keeps focus for its own arrow keys", async () => {
    const { window } = session;
    const player = window.locator(".own-player .vplayer");
    await player.hover();
    await player.getByRole("button", { name: "Settings" }).click();
    const menu = player.getByRole("menu", { name: "Settings" });
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await window.waitForTimeout(100);
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    // Esc closes only the menu, not the player.
    await expect(video(window)).toBeAttached();
  });

  test("during the ending, Skip plays the next episode", async () => {
    const { app, window } = session;
    const player = window.locator(".own-player .vplayer");
    await video(window).evaluate((node: HTMLVideoElement) => {
      node.currentTime = 27;
    });
    const next = player.getByRole("button", { name: /^Next episode: E2/ });
    await expect(next).toBeVisible();
    await expect(next).toContainText("Next episode");
    await next.click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { played?: number[] }).played?.at(-1)))
      .toBe(2);

    // With no menu open, Esc still leaves the player for the episode list.
    await expect(video(window)).toBeAttached();
    await window.keyboard.press("Escape");
    await expect(video(window)).toHaveCount(0);
  });
});
