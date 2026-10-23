import { expect, test, type Page } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";
import { catalogCalls, stubTitles } from "./stub-titles";

async function openFromForYou(window: Page, title: string): Promise<void> {
  await openSection(window, "Anime");
  await window
    .getByRole("region", { name: "For You recommendations" })
    .getByRole("button", { name: `Details for ${title}` })
    .click();
}

const episodes = (window: Page, title: string) =>
  window.getByRole("region", { name: `${title} episodes and player` });

test.describe("Anime episode list", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubTitles });
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("lists every aired episode of a title opened from For You", async () => {
    const { app, window } = session;
    await openFromForYou(window, "Fixture Finished Show");
    const list = episodes(window, "Fixture Finished Show");
    await expect(list.getByText(/12 episodes/)).toBeVisible();
    await expect(list.getByText("Episode 12", { exact: true }).first()).toBeAttached();
    // Never asked with the card's missing episode count (the one-episode bug).
    const calls = await catalogCalls(app, 8500001);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.totalEpisodes === 12)).toBe(true);
  });

  test("says which aired episodes the source has not added yet", async () => {
    const { window } = session;
    await openFromForYou(window, "Fixture Airing Show");
    const list = episodes(window, "Fixture Airing Show");
    await expect(
      list.getByText("Episodes 7–8 have aired, but the source hasn't added them yet."),
    ).toBeVisible();
    await expect(list.getByText(/6 of 8 aired/)).toBeVisible();
  });

  test("offers Retry when the episode list fails, and loads it", async () => {
    const { app, window } = session;
    await openFromForYou(window, "Fixture Flaky Show");
    const list = episodes(window, "Fixture Flaky Show");
    const retry = list.getByRole("button", { name: "Retry episodes" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(list.getByText(/3 episodes/)).toBeVisible();
    await expect(retry).toHaveCount(0);
    expect(await catalogCalls(app, 8500003)).toHaveLength(2);
  });

  test("hides the season box for a show with nothing else to pick", async () => {
    const { window } = session;
    await openFromForYou(window, "Fixture Finished Show");
    const list = episodes(window, "Fixture Finished Show");
    await expect(list.getByText(/12 episodes/)).toBeVisible();
    await expect(list.locator(".season-picker")).toHaveCount(0);
  });

  test("keeps the season box when there is another season", async () => {
    const { window } = session;
    await openFromForYou(window, "Fixture Airing Show");
    await expect(
      episodes(window, "Fixture Airing Show").getByRole("button", { name: /Season 2/ }),
    ).toBeVisible();
  });

  test("keeps the season box for a long runner browsed by arc", async () => {
    const { window } = session;
    await openFromForYou(window, "Fixture Long Runner");
    await expect(
      episodes(window, "Fixture Long Runner").getByRole("button", { name: /Fixture Arc One/ }),
    ).toBeVisible();
  });
});
