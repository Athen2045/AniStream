import { expect, test } from "@playwright/test";
import { launchApp, openSection, waitForShell, watchPainted, type TestApp } from "./app";

const TRENDING_LOADING = 'section[aria-label="Trending anime"] .rail-card-skeleton';

test.describe("Anime catalog", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows Trending and Latest Updates", async () => {
    const { window } = session;
    await openSection(window, "Anime");
    const trending = window.getByRole("region", { name: "Trending anime", exact: true });
    await expect(trending.getByText("Fixture Anime One").first()).toBeVisible();
    await expect(trending.getByText("Fixture Anime Three").first()).toBeVisible();
    const latest = window.getByRole("region", { name: "Latest anime updates" });
    await expect(latest.getByText("Fixture Latest One")).toBeVisible();
    await expect(latest.getByText("Fixture Latest Two")).toBeVisible();
  });

  test("keeps Trending when switching sections", async () => {
    const { window } = session;
    await openSection(window, "Manga");
    await expect(window.getByRole("region", { name: "Trending anime", exact: true })).toHaveCount(
      0,
    );
    const sawLoading = await watchPainted(window, TRENDING_LOADING);
    await openSection(window, "Anime");
    await expect(
      window
        .getByRole("region", { name: "Trending anime", exact: true })
        .getByText("Fixture Anime One")
        .first(),
    ).toBeVisible();
    expect(await sawLoading()).toBe(false);
  });

  test("pages Latest Updates without reloading Trending", async () => {
    const { window } = session;
    const latest = window.getByRole("region", { name: "Latest anime updates" });
    await expect(latest.getByText("Fixture Latest One")).toBeVisible();
    const sawLoading = await watchPainted(window, TRENDING_LOADING);
    await window
      .getByRole("navigation", { name: "Latest anime update pages" })
      .getByRole("button", { name: "Go to next page" })
      .click();
    await expect(latest.getByText("Fixture Latest Three")).toBeVisible();
    await expect(latest.getByText("Fixture Latest One")).toHaveCount(0);
    await expect(latest.getByText("Page 2")).toBeVisible();
    await expect(
      window
        .getByRole("region", { name: "Trending anime", exact: true })
        .getByText("Fixture Anime One")
        .first(),
    ).toBeVisible();
    expect(await sawLoading()).toBe(false);
  });
});
