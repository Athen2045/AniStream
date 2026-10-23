import { expect, test, type Page } from "@playwright/test";
import { launchApp, stubMember, waitForShell, type TestApp } from "./app";

const panel = (window: Page) => window.getByRole("region", { name: "Add title search" });
const animeResults = (window: Page) => panel(window).getByRole("region", { name: "Anime results" });

async function search(window: Page, query: string): Promise<void> {
  await panel(window).getByRole("textbox", { name: "Title search" }).fill(query);
  await panel(window).getByRole("button", { name: "Search", exact: true }).click();
}

test.describe("Profile Add title search", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubMember });
    await waitForShell(session.window);
    await session.window
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Your profile" })
      .click({ position: { x: 30, y: 21 } });
    await session.window.getByRole("button", { name: "Add title" }).click();
  });
  test.afterAll(async () => session?.close());

  test("finds titles to add", async () => {
    const { window } = session;
    await search(window, "Fixture Quest");
    await expect(animeResults(window).getByText("Results for “Fixture Quest”")).toBeVisible();
    await expect(animeResults(window).getByText("Fixture Quest Returns").first()).toBeVisible();
  });

  test("pages through the results", async () => {
    const { window } = session;
    // From the keyboard: on a small screen (CI) the pinned search form can sit over the button.
    await animeResults(window)
      .getByRole("navigation", { name: "ANIME search pages" })
      .getByRole("button", { name: "Go to next page" })
      .press("Enter");
    await expect(animeResults(window).getByText("Fixture Quest Finale").first()).toBeVisible();
    await expect(animeResults(window).getByText("Fixture Quest Returns")).toHaveCount(0);
  });

  test("says when nothing matches", async () => {
    const { window } = session;
    await search(window, "Fixtre Quest");
    await expect(animeResults(window).getByText("No matching anime.")).toBeVisible();
  });

  test("explains a failed search and offers Retry", async () => {
    const { window } = session;
    await search(window, "Fixture Broken");
    await expect(animeResults(window).getByRole("alert")).toBeVisible();
    await expect(animeResults(window).getByRole("button", { name: "Retry Anime" })).toBeVisible();
  });
});
