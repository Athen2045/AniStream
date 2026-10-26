import { expect, test } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";

// A stand-in for the More player that records the keys it receives.
const PLAYER_PAGE = `<!doctype html><body>
<script>
  window.keys = [];
  addEventListener("keydown", (event) => window.keys.push(event.key));
</script>
</body>`;

test.describe("Embedded player focus", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await session.window.route("https://more-player.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: PLAYER_PAGE }),
    );
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("the player frame has keyboard focus once it loads, so Space reaches it", async () => {
    const { window } = session;
    await openSection(window, "More");
    const movies = window.getByRole("region", { name: "Trending Movies" });
    await movies.getByRole("button", { name: "Open Fixture Movie One" }).first().click();
    const details = window.getByRole("region", { name: "Fixture Movie One details" });
    await details.getByRole("button", { name: "Play", exact: true }).click();

    const frame = window.locator("iframe.anime-embed-frame");
    await expect(frame).toBeFocused();
    await window.keyboard.press("Space");
    const player = window.frames().find((item) => item.url().startsWith("https://more-player."));
    await expect
      .poll(() => player?.evaluate(() => (window as { keys?: string[] }).keys))
      .toEqual([" "]);
    // Space went to the player, not to Back: the watch page is still open.
    await expect(frame).toBeVisible();
  });
});
