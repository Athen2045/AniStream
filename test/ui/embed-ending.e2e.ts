import { expect, test, type ElectronApplication } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";
import { stubTitles } from "./stub-titles";

// A stand-in for the anime player: it reports its time as the real one does, one second per tick,
// starting 10 seconds before the ending.
const PLAYER_PAGE = `<!doctype html><body><script>
  let time = 1290;
  setInterval(() => {
    time += 1;
    parent.postMessage({ event: "time", time, duration: 1420, percent: (time / 1420) * 100 }, "*");
  }, 250);
</script></body>`;

/** Every fixture episode plays in the embedded player, with an ending from 1300 to 1390 s. */
async function stubEmbed(app: ElectronApplication): Promise<void> {
  await stubTitles(app);
  await app.evaluate(({ ipcMain }) => {
    const asked: number[] = [];
    (globalThis as { asked?: number[] }).asked = asked;
    ipcMain.removeHandler("anime:playback");
    ipcMain.removeHandler("anime:skip-times");
    ipcMain.handle("anime:playback", (_event, input: { episode: number }) => {
      asked.push(input.episode);
      return {
        status: "available",
        attemptedSources: ["embed"],
        candidates: [
          {
            id: `embed-${input.episode}`,
            label: "Japanese · subtitles",
            kind: "embed",
            url: `https://anime-player.example/embed/${input.episode}/sub`,
          },
        ],
      };
    });
    ipcMain.handle("anime:skip-times", () => [{ kind: "ending", start: 1300, end: 1390 }]);
  });
}

test.describe("Embedded anime player ending", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubEmbed });
    await session.window.route("https://anime-player.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: PLAYER_PAGE }),
    );
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("offers Next episode during the ending, and it plays the next episode", async () => {
    const { app, window } = session;
    await openSection(window, "Anime");
    await window
      .getByRole("region", { name: "For You recommendations" })
      .getByRole("button", { name: "Watch Fixture Finished Show" })
      .click();
    await expect(window.locator("iframe.anime-embed-frame")).toBeAttached();

    const next = window.getByRole("button", { name: /^Next episode: E2/ });
    // Not before the ending starts (ten seconds in at four ticks a second: about 2.5 s).
    await expect(next).toHaveCount(0);
    await expect(next).toBeVisible({ timeout: 10_000 });
    await next.click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as { asked?: number[] }).asked?.at(-1)))
      .toBe(2);
    await expect(window.locator("iframe.anime-embed-frame")).toHaveAttribute("src", /\/embed\/2\//);
  });
});
