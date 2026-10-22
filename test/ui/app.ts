import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "../..");
// 1x1 transparent PNG for every remote image the window asks for.
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export interface TestApp {
  app: ElectronApplication;
  window: Page;
  close(): Promise<void>;
}

/**
 * Launches the built app (`npm run build` first) with a throwaway profile, the example provider
 * config (`.example` hosts only) and the fixture network from `fixtures/network.json`: no request
 * from the main process or the window reaches a real provider.
 */
export async function launchApp(options: { tmdb?: boolean } = {}): Promise<TestApp> {
  const workDir = mkdtempSync(join(tmpdir(), "anistream-ui-"));
  copyFileSync(join(ROOT, "providers.example.json"), join(workDir, "providers.local.json"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !key.startsWith("ANISTREAM_") && key !== "ELECTRON_RENDERER_URL")
      env[key] = value;
  Object.assign(env, {
    ANISTREAM_TEST_FIXTURES: join(import.meta.dirname, "fixtures", "network.json"),
    ANISTREAM_TEST_USER_DATA: join(workDir, "profile"),
    ANISTREAM_ANIME_SOURCE_ENABLED: "0",
    ...(options.tmdb === false ? {} : { ANISTREAM_TMDB_ACCESS_TOKEN: "fixture-token" }),
  });
  const app = await electron.launch({
    args: [ROOT],
    cwd: workDir,
    env,
  });
  app.process().stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("[AniStream test]")) process.stderr.write(text);
  });
  const window = await app.firstWindow();
  // Settings > Reduce motion (Windows ignores the system setting): no animation left half-run.
  await window.evaluate(() =>
    localStorage.setItem("anistream.preferences", JSON.stringify({ reduceMotion: true })),
  );
  await window.reload();
  await window.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.request().resourceType() === "image"
      ? route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG })
      : route.abort(),
  );
  return {
    app,
    window,
    async close() {
      await app.close();
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Waits for the launch checks to finish and the app shell to take input. */
export async function waitForShell(window: Page): Promise<void> {
  await window.getByRole("navigation", { name: "Main navigation" }).waitFor();
  await window.locator("main.app-shell:not([inert])").waitFor();
}

/** Opens a side-rail section. The buttons' hidden labels overhang the page, so click the icon. */
export async function openSection(window: Page, name: "Anime" | "Manga" | "More"): Promise<void> {
  await window
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true })
    .click({ position: { x: 30, y: 21 } });
}

/**
 * Starts watching for `selector` and returns whether a painted frame ever showed it. Sampled each
 * animation frame, so an element React replaces before the screen updates does not count.
 */
export async function watchPainted(
  window: Page,
  selector: string,
): Promise<() => Promise<boolean>> {
  const id = await window.evaluate((watched) => {
    const record = window as unknown as { painted?: Record<string, boolean> };
    const key = `${watched}#${Math.random()}`;
    record.painted = { ...record.painted, [key]: false };
    const sample = (): void => {
      if (document.querySelector(watched)) record.painted![key] = true;
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return key;
  }, selector);
  return () =>
    window.evaluate(
      (key) => Boolean((window as { painted?: Record<string, boolean> }).painted?.[key]),
      id,
    );
}
