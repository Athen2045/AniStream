import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";

/** Titles as AniList describes them; For You cards carry only id, title and cover. */
const TITLES = {
  8500001: { title: "Fixture Finished Show", status: "FINISHED", episodes: 12, listed: 12 },
  // Episode 9 airs next week, so 8 have aired; the source lists only 6.
  8500002: { title: "Fixture Airing Show", status: "RELEASING", episodes: 12, listed: 6, next: 9 },
  // The first episode-list request fails; Retry gets 3 episodes.
  8500003: { title: "Fixture Flaky Show", status: "FINISHED", episodes: 3, listed: 3, flaky: true },
} as const;

interface CatalogCall {
  aniListId: number;
  totalEpisodes: number;
}

/**
 * Stubs the main process for these titles: For You lists them, title details answer after half a
 * second (as AniList does), and the episode list answers from the source's numbers above.
 */
async function stubTitles(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, titles) => {
    const calls: unknown[] = [];
    (globalThis as { catalogCalls?: unknown[] }).catalogCalls = calls;
    const failed = new Set<number>();
    const card = (id: string) => ({
      anilistId: Number(id),
      mediaType: "ANIME",
      title: titles[id as keyof typeof titles].title,
      coverUrl: `https://img.anilist.example/${id}.jpg`,
      score: 0.8,
      reasonCodes: ["highly-rated"],
    });
    for (const channel of ["discovery:for-you", "anilist:media-detail", "anime:episode-catalog"])
      ipcMain.removeHandler(channel);
    ipcMain.handle("discovery:for-you", (_event, type: string) =>
      type === "ANIME"
        ? { status: "ready", requestId: "episodes-feed", items: Object.keys(titles).map(card) }
        : { status: "learning", items: [] },
    );
    ipcMain.handle("anilist:media-detail", async (_event, id: number) => {
      await new Promise((done) => setTimeout(done, 500));
      const known = titles[String(id) as keyof typeof titles] as {
        title: string;
        status: string;
        episodes: number;
        next?: number;
      };
      return {
        id,
        type: "ANIME",
        title: known.title,
        coverUrl: `https://img.anilist.example/${id}.jpg`,
        format: "TV",
        status: known.status,
        totalProgress: known.episodes,
        genres: ["Drama"],
        season: "SPRING",
        seasonYear: 2026,
        siteUrl: `https://anilist.co/anime/${id}`,
        ...(known.next
          ? {
              nextAiringEpisode: {
                episode: known.next,
                airingAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
              },
            }
          : {}),
        synonyms: [],
        studios: [],
        producers: [],
        characters: [],
        staff: [],
        relations: [],
        recommendations: [],
        externalLinks: [],
      };
    });
    ipcMain.handle(
      "anime:episode-catalog",
      (_event, input: { aniListId: number; totalEpisodes: number }) => {
        calls.push({ aniListId: input.aniListId, totalEpisodes: input.totalEpisodes });
        const known = titles[String(input.aniListId) as keyof typeof titles] as {
          listed: number;
          flaky?: boolean;
        };
        if (known.flaky && !failed.has(input.aniListId)) {
          failed.add(input.aniListId);
          throw new Error("The episode index timed out.");
        }
        return {
          status: "available",
          provider: "anime-source",
          checkedAt: new Date().toISOString(),
          seasons: [
            {
              id: `index:${input.aniListId}:season:1`,
              number: 1,
              title: "Season 1",
              episodes: Array.from({ length: known.listed }, (_, index) => ({
                id: `${input.aniListId}-${index + 1}`,
                number: index + 1,
              })),
            },
          ],
        };
      },
    );
  }, TITLES);
}

const catalogCalls = (app: ElectronApplication, id: number): Promise<CatalogCall[]> =>
  app.evaluate(
    (_electron, wanted) =>
      ((globalThis as { catalogCalls?: CatalogCall[] }).catalogCalls ?? []).filter(
        (call) => call.aniListId === wanted,
      ),
    id,
  );

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
});
