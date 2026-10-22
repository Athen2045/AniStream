import { expect, test } from "@playwright/test";
import { launchApp, openSection, waitForShell, watchPainted, type TestApp } from "./app";

test.describe("More Trending", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp();
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows the Trending Movies and Shows rails", async () => {
    const { window } = session;
    await openSection(window, "More");
    const movies = window.getByRole("region", { name: "Trending Movies" });
    const shows = window.getByRole("region", { name: "Trending Shows" });
    await expect(movies.getByText("Fixture Movie One").first()).toBeVisible();
    await expect(movies.getByText("Fixture Movie Three").first()).toBeVisible();
    await expect(shows.getByText("Fixture Show One").first()).toBeVisible();
  });

  test("keeps the rails when More is opened again", async () => {
    const { window } = session;
    await openSection(window, "Anime");
    await expect(window.getByRole("region", { name: "Trending Movies" })).toHaveCount(0);
    const sawLoading = await watchPainted(window, ".more-hero--skeleton");
    await openSection(window, "More");
    await expect(
      window
        .getByRole("region", { name: "Trending Movies" })
        .getByText("Fixture Movie One")
        .first(),
    ).toBeVisible();
    expect(await sawLoading()).toBe(false);
  });

  test("pages through the full Trending Movies list", async () => {
    const { window } = session;
    await window
      .getByRole("region", { name: "Trending Movies" })
      .getByRole("button", { name: "View all" })
      .click();
    const grid = window.getByRole("region", { name: "Trending movies", exact: true });
    await expect(grid.getByText("Fixture Movie Two").first()).toBeVisible();
    await window
      .getByRole("navigation", { name: "Trending movies pages" })
      .getByRole("button", { name: "Go to next page" })
      .click();
    await expect(grid.getByText("Fixture Movie Four").first()).toBeVisible();
    await expect(grid.getByText("Fixture Movie Two")).toHaveCount(0);
  });
});

test.describe("More without TMDB", () => {
  test("explains the missing TMDB setup", async () => {
    const session = await launchApp({ tmdb: false });
    try {
      await waitForShell(session.window);
      await openSection(session.window, "More");
      await expect(session.window.getByText("TMDB setup required")).toBeVisible();
      await expect(session.window.getByRole("button", { name: "Retry catalog" })).toBeVisible();
    } finally {
      await session.close();
    }
  });
});
