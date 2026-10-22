import { expect, test, type Page } from "@playwright/test";
import { launchApp, openSection, waitForShell, watchPainted, type TestApp } from "./app";

const field = (window: Page) => window.getByRole("combobox", { name: "Search anime" });
const results = (window: Page) => window.locator(".section-search-results");

test.describe("Anime search", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows Trending now while the field is empty", async () => {
    const { window } = session;
    await openSection(window, "Anime");
    await openSection(window, "Search");
    await expect(field(window)).toBeFocused();
    await expect(window.getByRole("heading", { name: "Trending now" })).toBeVisible();
    await expect(results(window).getByText("Fixture Anime One").first()).toBeVisible();
  });

  test("finds titles while typing and loads more on request", async () => {
    const { window } = session;
    await field(window).fill("Fixture Quest");
    await expect(results(window).getByText("Fixture Quest Returns").first()).toBeVisible();
    await expect(results(window).getByText("2+ anime")).toBeVisible();

    await window.getByRole("button", { name: "Show more results" }).click();
    await expect(results(window).getByText("Fixture Quest Finale").first()).toBeVisible();
    await expect(results(window).getByText("Fixture Quest Returns").first()).toBeVisible();
    await expect(window.getByRole("button", { name: "Show more results" })).toHaveCount(0);
  });

  test("keeps the search when returning from another section", async () => {
    const { window } = session;
    await openSection(window, "Anime");
    const sawSearching = await watchPainted(window, ".section-search-results.is-pending");
    await openSection(window, "Search");
    await expect(field(window)).toHaveValue("Fixture Quest");
    // The pages loaded with "Show more" come back too, without searching again.
    await expect(results(window).getByText("Fixture Quest Finale").first()).toBeVisible();
    await expect(results(window).getByText("Fixture Quest Returns").first()).toBeVisible();
    expect(await sawSearching()).toBe(false);
  });

  test("offers the likely title when a typo finds nothing", async () => {
    const { window } = session;
    await field(window).fill("Fixtre Quest");
    const suggestion = window.getByRole("button", { name: "Search “Fixture Quest” instead" });
    await expect(suggestion).toBeVisible();
    await suggestion.click();
    await expect(field(window)).toHaveValue("Fixture Quest");
    await expect(results(window).getByText("Fixture Quest Returns").first()).toBeVisible();
  });
});
