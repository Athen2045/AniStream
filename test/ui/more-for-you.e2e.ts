import { expect, test, type Page } from "@playwright/test";
import {
  launchApp,
  openSection,
  seedFieldSnapshot,
  waitForShell,
  watchPainted,
  type TestApp,
} from "./app";

function pick(id: number, title: string) {
  return {
    item: {
      id,
      type: "MOVIE",
      title,
      posterUrl: `https://image.tmdb.org/t/p/w500/rec-${id}.jpg`,
      genres: ["Drama"],
      siteUrl: `https://www.themoviedb.org/movie/${id}`,
    },
    reasonCodes: ["similar-to"],
    relatedTitle: "Fixture Seed",
  };
}

/** A guest's saved More For You feed, as the app keeps it between launches. */
const SAVED_FEED = {
  status: "ready",
  basis: "more",
  requestId: "fixture-more-feed",
  sectionTitles: 3,
  items: [pick(9200001, "Fixture Pick One"), pick(9200002, "Fixture Pick Two")],
  rows: [
    {
      seedTitle: "Fixture Seed",
      seedType: "MOVIE",
      seedId: 9200100,
      items: [pick(9200003, "Fixture Row Pick")],
    },
  ],
};

const forYou = (window: Page) => window.getByRole("region", { name: "For You", exact: true });

test.describe("More For You", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({
      seed: (database) => seedFieldSnapshot(database, "more-for-you:0", SAVED_FEED),
    });
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows the saved feed and its Because you watched row", async () => {
    const { window } = session;
    await openSection(window, "More");
    await expect(
      forYou(window).getByText("Fixture Pick One", { exact: true }).first(),
    ).toBeVisible();
    await expect(forYou(window).getByText("Fixture Pick Two").first()).toBeVisible();
    await expect(
      window
        .getByRole("region", { name: "Because you watched Fixture Seed", exact: true })
        .getByText("Fixture Row Pick")
        .first(),
    ).toBeVisible();
  });

  test("keeps the feed when More is opened again", async () => {
    const { window } = session;
    await openSection(window, "Anime");
    await expect(forYou(window)).toHaveCount(0);
    const sawMissing = await watchPainted(
      window,
      '.more-page:not(:has(section[aria-label="For You"]))',
    );
    await openSection(window, "More");
    await expect(
      forYou(window).getByText("Fixture Pick One", { exact: true }).first(),
    ).toBeVisible();
    expect(await sawMissing()).toBe(false);
  });

  test("hides a Not interested title, also after switching sections", async () => {
    const { window } = session;
    const card = forYou(window).getByRole("button", { name: "Not interested in Fixture Pick One" });
    await card.click({ force: true });
    await expect(forYou(window).getByText("Fixture Pick One", { exact: true })).toHaveCount(0);
    await expect(window.getByText("Fixture Pick One hidden from For You.")).toBeVisible();
    await expect(forYou(window).getByText("Fixture Pick Two").first()).toBeVisible();

    await openSection(window, "Anime");
    await openSection(window, "More");
    await expect(forYou(window).getByText("Fixture Pick Two").first()).toBeVisible();
    await expect(forYou(window).getByText("Fixture Pick One", { exact: true })).toHaveCount(0);
  });

  test("Undo restores the choice and asks for a rebuilt feed", async () => {
    const { window } = session;
    await forYou(window)
      .getByRole("button", { name: "Not interested in Fixture Pick Two" })
      .click({ force: true });
    await expect(window.getByText("Fixture Pick Two hidden from For You.")).toBeVisible();
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(window.getByText("Fixture Pick Two hidden from For You.")).toHaveCount(0);
    // This throwaway profile has no watch history, so the rebuilt feed is still learning and
    // the rail steps aside for the page's own rows.
    await expect(forYou(window)).toHaveCount(0);
    await expect(window.getByText("Could not undo this choice")).toHaveCount(0);
  });
});
