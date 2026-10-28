import { expect, test } from "@playwright/test";
import { launchApp, openSection, setOffline, waitForShell, type TestApp } from "./app";

test.describe("Starting without a connection", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ offline: true });
  });
  test.afterAll(async () => session?.close());

  test("opens straight into the app, on what works offline", async () => {
    const { window } = session;
    // No launch error to click past (it used to blame AniList and wait for "Continue browsing").
    await waitForShell(window);
    await expect(window.getByText("You’re offline").first()).toBeVisible();
    await expect(window.getByRole("heading", { name: "Downloaded" })).toBeVisible();
  });

  test("says it is offline in each section instead of a service error or a spinner", async () => {
    const { window } = session;
    await openSection(window, "More");
    await expect(
      window.getByText("You're offline. Reconnect to load movies and shows."),
    ).toBeVisible();
    // Manga, like Anime, keeps to what works offline: its downloaded titles.
    await openSection(window, "Manga");
    await expect(window.getByRole("heading", { name: "Downloaded" })).toBeVisible();
    await expect(
      window.getByText("Downloaded chapters read here without a connection."),
    ).toBeVisible();
    await window
      .getByRole("button", { name: "Schedule", exact: true })
      .first()
      .click({
        position: { x: 30, y: 21 },
      });
    await expect(window.getByText("You're offline. Reconnect to load airing times.")).toBeVisible();
    // No week of empty days that would read as "nothing airs".
    await expect(window.getByText("Nothing airing")).toHaveCount(0);
  });
});

test.describe("Losing the connection and getting it back", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows the offline message, then loads by itself when back online", async () => {
    const { app, window } = session;
    await openSection(window, "Anime");
    await expect(window.getByRole("heading", { name: "Trending anime" })).toBeVisible();
    await setOffline(app, window, true);
    // A section first opened offline: a message, not placeholders forever.
    await openSection(window, "More");
    const offlineNote = window.getByText("You're offline. Reconnect to load movies and shows.");
    await expect(offlineNote).toBeVisible();
    await setOffline(app, window, false);
    // Back online, the failed section loads again without a click.
    await expect(offlineNote).toHaveCount(0);
    await expect(window.getByRole("region", { name: "Trending Movies" }).first()).toBeVisible();
  });
});

test.describe("Closing the window", () => {
  test("quits by default", async () => {
    const session = await launchApp();
    await waitForShell(session.window);
    const exited = new Promise((resolve) => session.app.process().once("exit", resolve));
    await session.app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
      .catch(() => undefined);
    await exited;
    await session.close().catch(() => undefined);
  });

  test("keeps AniStream running in the tray when the setting is on", async () => {
    const session = await launchApp();
    try {
      await waitForShell(session.window);
      await session.window.evaluate(() =>
        window.anistream.setBackgroundPreferences({ keepRunning: true, whileDownloading: "ask" }),
      );
      const state = await session.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.close();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { windows: BrowserWindow.getAllWindows().length, visible: window.isVisible() };
      });
      expect(state).toEqual({ windows: 1, visible: false });
    } finally {
      await session.close();
    }
  });
});
