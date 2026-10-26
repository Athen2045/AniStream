import { expect, test, type ElectronApplication } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";

/** A guest halfway through episode 3 of one show, from this device's activity. */
async function stubActivity(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("activity:list");
    ipcMain.handle("activity:list", () => [
      {
        media: {
          id: 8_600_001,
          type: "ANIME",
          title: "Fixture Continue Show",
          coverUrl: "https://img.anilist.example/8600001.jpg",
          format: "TV",
          status: "FINISHED",
          totalProgress: 12,
          genres: [],
          seasonYear: 2026,
          siteUrl: "https://anilist.co/anime/8600001",
        },
        unit: 3,
        state: "started",
        completedProgress: 2,
        updatedAt: new Date().toISOString(),
        syncStatus: "local",
      },
    ]);
  });
}

test.describe("Anime Continue Watching", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubActivity });
    await waitForShell(session.window);
    await openSection(session.window, "Anime");
  });
  test.afterAll(async () => session?.close());

  test("shows the X on hover; it removes the title, and Undo brings it back", async () => {
    const { window } = session;
    const row = window.getByRole("region", { name: "Continue Watching" }).first();
    const card = row.locator(".anime-continue-card", { hasText: "Fixture Continue Show" });
    const remove = card.getByRole("button", {
      name: "Remove Fixture Continue Show from Continue",
    });
    await expect(remove).toHaveCSS("opacity", "0");
    await card.hover();
    await expect(remove).toHaveCSS("opacity", "1");

    await remove.click();
    await expect(card).toHaveCount(0);
    const toast = window.getByRole("status").filter({ hasText: "removed from Continue Watching" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(
      window.locator(".anime-continue-card", { hasText: "Fixture Continue Show" }),
    ).toBeVisible();
  });
});
