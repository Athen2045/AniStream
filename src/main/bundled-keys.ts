import { existsSync, readFileSync } from "node:fs";

/** Packaged resource written at build time (gitignored); see scripts/write-app-keys.mjs. */
export const BUNDLED_KEYS_FILE = "app-keys.local.json";

/**
 * Read-only public-data keys a packaged build may ship so installs work without setup. Personal
 * credentials (MangaBaka PAT, account tokens) must never be added here: a shipped key can be read
 * by anyone who installs the app. Keep in sync with scripts/write-app-keys.mjs.
 */
export const BUNDLED_KEY_NAMES = [
  "ANISTREAM_TMDB_ACCESS_TOKEN",
  "ANISTREAM_MAL_CLIENT_ID",
] as const;

const MAX_VALUE_LENGTH = 4096;

/**
 * Applies bundled keys as the lowest-precedence defaults: a value already in the environment
 * (shell, project `.env`, or the user's own `.env`) always wins. Unknown names and malformed
 * values are ignored so a bad build file cannot set anything outside the allowlist.
 */
export function loadBundledKeys(path: string): string[] {
  if (!existsSync(path)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn("AniStream ignored an unreadable bundled key file.");
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("AniStream ignored a bundled key file that is not a JSON object.");
    return [];
  }

  const record = parsed as Record<string, unknown>;
  const applied: string[] = [];
  for (const name of BUNDLED_KEY_NAMES) {
    const value = record[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH || /[\r\n]/u.test(trimmed)) continue;
    if (process.env[name]?.trim()) continue;
    process.env[name] = trimmed;
    applied.push(name);
  }
  return applied;
}
