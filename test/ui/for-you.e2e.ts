import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, openSection, waitForShell, watchPainted, type TestApp } from "./app";

function pick(anilistId: number, title: string) {
  return {
    anilistId,
    mediaType: "ANIME",
    title,
    coverUrl: `https://img.anilist.example/${anilistId}.jpg`,
    score: 0.8,
    reasonCodes: ["similar-to"],
    relatedTitle: "Fixture Seed Anime",
  };
}

const ANIME_FEED = {
  status: "ready",
  sectionTitles: 3,
  items: [pick(8300001, "Fixture For You One"), pick(8300002, "Fixture For You Two")],
  rows: [
    {
      seedId: 8300100,
      seedTitle: "Fixture Seed Anime",
      items: [pick(8300003, "Fixture For You Row")],
    },
  ],
};

interface Call {
  channel: "for-you" | "feedback";
  type?: string;
  fresh?: boolean;
  action?: string;
  anilistId?: number;
}

/**
 * Replaces the main process's For You handlers: a guest feed is otherwise built from local activity
 * and AniList lookups, which these renderer tests do not exercise. Calls are recorded.
 */
async function stubForYou(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, feed) => {
    const calls: unknown[] = [];
    (globalThis as { forYouCalls?: unknown[] }).forYouCalls = calls;
    let version = 0;
    for (const channel of ["discovery:for-you", "discovery:feedback", "discovery:impressions"])
      ipcMain.removeHandler(channel);
    ipcMain.handle("discovery:for-you", (_event, type: string, fresh?: boolean) => {
      calls.push({ channel: "for-you", type, fresh: fresh === true });
      return type === "ANIME"
        ? { ...feed, requestId: `anime-feed-${++version}` }
        : { status: "learning", items: [], message: "Learning." };
    });
    ipcMain.handle("discovery:feedback", (_event, input: Record<string, unknown>) => {
      calls.push({ channel: "feedback", action: input.action, anilistId: input.anilistId });
    });
    ipcMain.handle("discovery:impressions", () => undefined);
  }, ANIME_FEED);
}

const calls = (app: ElectronApplication): Promise<Call[]> =>
  app.evaluate(() => [...((globalThis as { forYouCalls?: Call[] }).forYouCalls ?? [])]);
const animeLoads = async (app: ElectronApplication): Promise<Call[]> =>
  (await calls(app)).filter((call) => call.channel === "for-you" && call.type === "ANIME");
const rail = (window: Page) => window.getByRole("region", { name: "For You recommendations" });

test.describe("Anime For You", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubForYou });
    await waitForShell(session.window);
  });
  test.afterAll(async () => session?.close());

  test("shows the feed and its Because you watched row", async () => {
    const { app, window } = session;
    await openSection(window, "Anime");
    await expect(rail(window).getByText("Fixture For You One").first()).toBeVisible();
    await expect(
      window
        .getByRole("region", { name: "Because you watched Fixture Seed Anime", exact: true })
        .getByText("Fixture For You Row")
        .first(),
    ).toBeVisible();
    // The first load may use a saved feed.
    expect((await animeLoads(app)).map((call) => call.fresh)).toEqual([false]);
  });

  test("keeps the feed when switching sections, without asking again", async () => {
    const { app, window } = session;
    await openSection(window, "Manga");
    await expect(rail(window).getByText("Fixture For You One")).toHaveCount(0);
    const sawMissing = await watchPainted(
      window,
      '.catalog-content:has(section[aria-label="Trending anime"]):not(:has(.for-you-card))',
    );
    await openSection(window, "Anime");
    await expect(rail(window).getByText("Fixture For You One").first()).toBeVisible();
    expect(await sawMissing()).toBe(false);
    expect(await animeLoads(app)).toHaveLength(1);
  });

  test("Not interested hides the title and keeps Undo across sections", async () => {
    const { app, window } = session;
    const card = rail(window)
      .locator("article")
      .filter({ has: window.getByRole("button", { name: "Fixture For You One", exact: true }) });
    await card.hover();
    await card.getByRole("button", { name: "Not interested in Fixture For You One" }).click();
    await expect(rail(window).getByText("Fixture For You One")).toHaveCount(0);
    await expect(rail(window).getByText("Title hidden from For You.")).toBeVisible();
    expect(await calls(app)).toContainEqual({
      channel: "feedback",
      action: "dismiss",
      anilistId: 8300001,
    });

    await openSection(window, "Manga");
    await openSection(window, "Anime");
    await expect(rail(window).getByText("Fixture For You Two").first()).toBeVisible();
    await expect(rail(window).getByText("Fixture For You One")).toHaveCount(0);
    await expect(rail(window).getByText("Title hidden from For You.")).toBeVisible();
  });

  test("Undo sends the undo and rebuilds the feed", async () => {
    const { app, window } = session;
    await rail(window).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rail(window).getByText("Fixture For You One").first()).toBeVisible();
    await expect(rail(window).getByText("Title hidden from For You.")).toHaveCount(0);
    expect(await calls(app)).toContainEqual({
      channel: "feedback",
      action: "undo",
      anilistId: 8300001,
    });
    expect((await animeLoads(app)).map((call) => call.fresh)).toEqual([false, true]);
  });

  test("Refresh rebuilds the feed", async () => {
    const { app, window } = session;
    await rail(window).getByRole("button", { name: "Refresh" }).click();
    await expect.poll(async () => (await animeLoads(app)).length).toBe(3);
    expect((await animeLoads(app)).at(-1)?.fresh).toBe(true);
    await expect(rail(window).getByRole("button", { name: "Refresh" })).toBeEnabled();
    await expect(rail(window).getByText("Fixture For You One").first()).toBeVisible();
  });
});
