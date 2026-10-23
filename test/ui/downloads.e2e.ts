import { expect, test, type Locator } from "@playwright/test";
import { launchApp, openSection, waitForShell, type TestApp } from "./app";
import { stubTitles } from "./stub-titles";

/** True when `target` is what sits on top at its own centre (nothing covers or cuts it off). */
const onTop = (target: Locator): Promise<boolean> =>
  target.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });

test.describe("Season download", () => {
  let session: TestApp;
  test.beforeAll(async () => {
    session = await launchApp({ setup: stubTitles });
    await waitForShell(session.window);
    await openSection(session.window, "Anime");
    await session.window
      .getByRole("region", { name: "For You recommendations" })
      .getByRole("button", { name: "Details for Fixture Finished Show" })
      .click();
  });
  test.afterAll(async () => session?.close());

  test("asks in a centred dialog that Escape closes, leaving the title page open", async () => {
    const { window } = session;
    await window.getByRole("button", { name: "Download", exact: true }).first().click();
    const dialog = window.getByRole("dialog", { name: "Download episodes" });
    await expect(dialog.getByText(/Download 12 episodes at/)).toBeVisible();
    const box = (await dialog.boundingBox())!;
    const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(4);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(4);
    expect(await onTop(dialog.getByRole("button", { name: "Download all" }))).toBe(true);

    await window.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(window.getByRole("heading", { name: "Fixture Finished Show" })).toBeVisible();
  });

  test("Download all queues every aired episode", async () => {
    const { window } = session;
    await window.getByRole("button", { name: "Download", exact: true }).first().click();
    await window
      .getByRole("dialog", { name: "Download episodes" })
      .getByRole("button", { name: "Download all" })
      .click();
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const state = await (
            window as unknown as {
              anistream: { getDownloads(): Promise<{ items: { aniListId: number }[] }> };
            }
          ).anistream.getDownloads();
          return state.items.filter((item) => item.aniListId === 8500001).length;
        }),
      )
      .toBe(12);
    await expect(window.getByRole("button", { name: "Downloaded", exact: true })).toBeVisible();
  });
});
