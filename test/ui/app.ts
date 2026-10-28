import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  /** Quits and starts again on the same profile (e.g. "used yesterday, offline today"). */
  restart(options?: { offline?: boolean }): Promise<void>;
  close(): Promise<void>;
}

/**
 * Launches the built app (`npm run build` first) with a throwaway profile, the example provider
 * config (`.example` hosts only) and the fixture network from `fixtures/network.json`: no request
 * from the main process or the window reaches a real provider. `seed` edits the profile's
 * database between a first launch (which creates it) and the launch the test uses. `setup` runs
 * before the window loads the renderer the test uses, e.g. to stub a main-process handler.
 */
export async function launchApp(
  options: {
    tmdb?: boolean;
    seed?: (database: string) => void;
    setup?: (app: ElectronApplication) => Promise<void>;
    /** Start with no connection at all (see `setOffline`). */
    offline?: boolean;
  } = {},
): Promise<TestApp> {
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
  if (options.seed) {
    const first = await start(workDir, env);
    await waitForShell(first.window);
    await first.app.close();
    options.seed(join(workDir, "profile", "anistream.sqlite"));
  }
  const launch = (offline: boolean | undefined) =>
    start(workDir, env, async (started, page) => {
      await options.setup?.(started);
      if (offline) await setOffline(started, page, true);
    });
  const session: TestApp = {
    ...(await launch(options.offline)),
    async restart(next = {}) {
      await session.app.close();
      Object.assign(session, await launch(next.offline));
    },
    async close() {
      await session.app.close();
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
  return session;
}

async function start(
  workDir: string,
  env: Record<string, string>,
  setup?: (app: ElectronApplication, window: Page) => Promise<void>,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({ args: [ROOT], cwd: workDir, env });
  app.process().stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("[AniStream test]")) process.stderr.write(text);
  });
  const window = await app.firstWindow();
  // The window's own internet requests: images get a blank PNG, the rest fail (offline: all fail).
  await window.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    !offlineWindows.has(window) && route.request().resourceType() === "image"
      ? route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG })
      : route.abort(offlineWindows.has(window) ? "internetdisconnected" : "failed"),
  );
  // `navigator.onLine` follows `setOffline` (Chromium's own offline mode would also cut the
  // window's loopback server, which a real disconnect never does).
  await window.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => localStorage.getItem("anistream.test.offline") !== "1",
    });
  });
  await window.evaluate(() => localStorage.removeItem("anistream.test.offline"));
  await setup?.(app, window);
  // Settings > Reduce motion (Windows ignores the system setting): no animation left half-run.
  await window.evaluate(() =>
    localStorage.setItem("anistream.preferences", JSON.stringify({ reduceMotion: true })),
  );
  await window.reload();
  return { app, window };
}

const offlineWindows = new WeakSet<Page>();

/**
 * Cuts (or restores) the internet the way a dropped connection does: the window's internet
 * requests fail and `navigator.onLine` turns false (with the offline/online event), and the main
 * process's `fetch` (data services) and `net.fetch` (downloads, stream proxy) fail. The window's
 * own loopback server keeps working, as it does on a real disconnect. Works at launch and
 * mid-session.
 */
export async function setOffline(
  app: ElectronApplication,
  window: Page,
  offline: boolean,
): Promise<void> {
  if (offline) offlineWindows.add(window);
  else offlineWindows.delete(window);
  await app.evaluate(({ net }, cut) => {
    // Data-service clients: the test-mode `fetch` they were built with checks this flag.
    (globalThis as { anistreamTestOffline?: boolean }).anistreamTestOffline = cut;
    // Downloads and the stream proxy call `net.fetch` or `net.request` (net-request-fetch.ts)
    // each time; the device check follows too.
    const saved = globalThis as {
      onlineNetFetch?: typeof net.fetch;
      onlineNetRequest?: typeof net.request;
      onlineCheck?: typeof net.isOnline;
    };
    saved.onlineNetFetch ??= net.fetch.bind(net);
    saved.onlineNetRequest ??= net.request.bind(net);
    saved.onlineCheck ??= net.isOnline.bind(net);
    net.fetch = cut
      ? ((async () => {
          throw new TypeError("fetch failed");
        }) as typeof net.fetch)
      : saved.onlineNetFetch;
    net.request = cut
      ? ((() => {
          throw new TypeError("fetch failed");
        }) as typeof net.request)
      : saved.onlineNetRequest;
    net.isOnline = cut ? () => false : saved.onlineCheck;
  }, offline);
  // The page hears about it last, as on a real reconnect (the network works before "online").
  await window.evaluate((cut) => {
    if (cut) localStorage.setItem("anistream.test.offline", "1");
    else localStorage.removeItem("anistream.test.offline");
    window.dispatchEvent(new Event(cut ? "offline" : "online"));
  }, offline);
}

/** Saves `value` as a home field's saved copy (`field_snapshot_v1`), for both title languages. */
export function seedFieldSnapshot(database: string, key: string, value: unknown): void {
  const db = new DatabaseSync(database);
  try {
    const write = db.prepare(
      "INSERT OR REPLACE INTO field_snapshot_v1 (key, payload, saved_at) VALUES (?, ?, ?)",
    );
    for (const scope of ["titles-en", "titles-anilist"])
      write.run(`${scope}:${key}`, JSON.stringify(value), Date.now());
  } finally {
    db.close();
  }
}

/** Waits for the launch checks to finish and the app shell to take input. */
export async function waitForShell(window: Page): Promise<void> {
  await window.getByRole("navigation", { name: "Main navigation" }).waitFor();
  await window.locator("main.app-shell:not([inert])").waitFor();
}

/** Opens a side-rail section. The buttons' hidden labels overhang the page, so click the icon. */
export async function openSection(
  window: Page,
  name: "Search" | "Anime" | "Manga" | "More",
): Promise<void> {
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

/** The fixture AniList account `stubMember` signs in (renderer only; no token exists anywhere). */
export const FIXTURE_MEMBER = {
  id: 7_000_001,
  name: "FixtureViewer",
  avatarUrl: "https://img.anilist.example/avatar.png",
  siteUrl: "https://anilist.co/user/FixtureViewer",
  animeCount: 0,
  episodesWatched: 0,
  minutesWatched: 0,
  mangaCount: 0,
  chaptersRead: 0,
  volumesRead: 0,
};

/**
 * A `launchApp({ setup })` step: answers the window's AniList sign-in and library calls with a
 * signed-in fixture member and empty lists, so member-only screens (Profile, library) can be
 * tested. The main process itself stays signed out.
 */
export async function stubMember(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, profile) => {
    const dashboard = {
      profile,
      animeLists: [],
      mangaLists: [],
      fetchedAt: new Date().toISOString(),
    };
    for (const channel of ["anilist:auth-state", "anilist:dashboard", "anilist:cached-dashboard"])
      ipcMain.removeHandler(channel);
    ipcMain.handle("anilist:auth-state", () => ({ status: "signed-in", profile }));
    ipcMain.handle("anilist:dashboard", () => dashboard);
    ipcMain.handle("anilist:cached-dashboard", () => dashboard);
  }, FIXTURE_MEMBER);
}
