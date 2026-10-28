import { expect, test } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";

// A stand-in More player; the test drives it from inside its own frame.
const PLAYER_PAGE = `<!doctype html><body>player</body>`;
const OFFLINE_FILE = "anistream-media://offline/0b6f3c7e-0000-4000-8000-000000000000/master.m3u8";
const ARTWORK = "anistream-art://image/?src=https%3A%2F%2Fs4.anilist.co%2Ffile%2Fx.jpg";

/** What a fetch from one document gets: the HTTP status, or "blocked" when it cannot read it. */
const attempt = (url: string): Promise<string> =>
  fetch(url).then(
    (response) => String(response.status),
    () => "blocked",
  );

test.describe("Player frame isolation (audit findings 5 and 6)", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await session.window.route("https://more-player.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: PLAYER_PAGE }),
    );
    await waitForShell(session.window);
    await openSection(session.window, "More");
    const movies = session.window.getByRole("region", { name: "Trending Movies" });
    await movies.getByRole("button", { name: "Open Fixture Movie One" }).first().click();
    await session.window
      .getByRole("region", { name: "Fixture Movie One details" })
      .getByRole("button", { name: "Play", exact: true })
      .click();
    await expect(session.window.locator("iframe.anime-embed-frame")).toBeVisible();
  });
  test.afterAll(async () => session?.close());

  const playerFrame = () =>
    session.window.frames().find((frame) => frame.url().startsWith("https://more-player."))!;

  test("a More player that opts in is framed with the sandbox: scripts and own storage only", async () => {
    await expect(session.window.locator("iframe.anime-embed-frame")).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    await expect
      .poll(() => playerFrame()?.evaluate(() => document.body.textContent))
      .toBe("player");
  });

  test("a player frame cannot read AniStream's stream, offline or artwork addresses", async () => {
    const frame = playerFrame();
    expect(await frame.evaluate(attempt, OFFLINE_FILE)).toBe("blocked");
    expect(await frame.evaluate(attempt, ARTWORK)).toBe("blocked");
    // The app's own page still reaches them (an unknown download is simply not found).
    expect(await session.window.evaluate(attempt, OFFLINE_FILE)).toBe("404");
  });

  test("a player frame cannot load them as images or media either", async () => {
    const load = (url: string): Promise<string> =>
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve("loaded");
        image.onerror = () => resolve("refused");
        image.src = url;
      });
    // Both get an error image (unknown artwork is not found), so tell them apart by whether the
    // request filter cancelled it.
    await session.app.evaluate(({ session: electronSession }) => {
      const errors: string[] = [];
      (globalThis as { schemeErrors?: string[] }).schemeErrors = errors;
      electronSession.defaultSession.webRequest.onErrorOccurred(
        { urls: ["anistream-art://*/*", "anistream-media://*/*"] },
        (details) => errors.push(`${details.frame?.origin ?? "?"} ${details.error}`),
      );
    });
    const errors = () =>
      session.app.evaluate(() => (globalThis as { schemeErrors?: string[] }).schemeErrors ?? []);
    expect(await playerFrame().evaluate(load, ARTWORK)).toBe("refused");
    await expect.poll(errors).toEqual(["https://more-player.example net::ERR_BLOCKED_BY_CLIENT"]);
    // The app's own page is answered, not cancelled.
    expect(await session.window.evaluate(attempt, OFFLINE_FILE)).toBe("404");
    expect(await errors()).toHaveLength(1);
  });
});
