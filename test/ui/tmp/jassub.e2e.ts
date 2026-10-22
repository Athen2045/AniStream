import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, test } from "@playwright/test";

test("own player subtitles with the JASSUB update", async () => {
  test.setTimeout(300_000);
  const ROOT = resolve(import.meta.dirname, "../../..");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ANISTREAM_") && k !== "ELECTRON_RENDERER_URL") env[k] = v;
  env.ANISTREAM_TEST_USER_DATA = mkdtempSync(join(tmpdir(), "anistream-live-"));
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const window = await app.firstWindow();
  const errors: string[] = [];
  window.on("console", (m) => { if (m.type() === "error" && /jassub|subtitle|wasm|worker/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
  window.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await window.locator("main.app-shell:not([inert])").waitFor({ timeout: 60_000 });
  await window.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Search", exact: true }).click({ position: { x: 30, y: 21 } });
  const field = window.getByRole("combobox", { name: "Search anime" });
  await field.fill("Frieren");
  await field.press("Enter");
  await window.locator(".section-search-results h2").first().locator("xpath=ancestor::*[.//button][1]").getByRole("button", { name: "Details", exact: true }).click({ timeout: 30_000 });
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("anime:playback");
    ipcMain.handle("anime:playback", () => ({ status: "unavailable", candidates: [], attemptedSources: [], message: "Main player has no source in this check." }));
  });
  await window.getByRole("button", { name: /^Play episode 1:/ }).first().click({ timeout: 60_000 });
  await window.waitForFunction(() => { const v = document.querySelector("video"); return v && v.duration > 60; }, undefined, { timeout: 90_000 });
  await window.locator("video").first().evaluate(async (v: HTMLVideoElement) => { v.muted = true; await v.play().catch(() => undefined); v.currentTime = 300; });
  await window.waitForTimeout(8000);
  const state = await window.evaluate(() => ({
    canvas: [...document.querySelectorAll("canvas")].map((c) => `${c.width}x${c.height}`),
    vttCues: [...document.querySelectorAll("video")].flatMap((v) => [...v.textTracks].map((t) => `${t.kind}:${t.mode}:${t.activeCues?.length ?? 0}`)),
  }));
  console.log("subtitle surfaces:", JSON.stringify(state));
  console.log("subtitle errors:", JSON.stringify(errors));
  await window.screenshot({ path: "test-results/jassub.png" });
  await app.close();
});
