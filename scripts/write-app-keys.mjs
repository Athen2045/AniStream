// Writes the gitignored app-keys.local.json that packaged builds ship as a resource, so an install
// can load More (TMDB) and MAL scores without per-user setup. Values come from the environment
// (CI secrets) first, then the project .env (local builds). Only these read-only public-data keys
// are ever written; keep the list in sync with BUNDLED_KEY_NAMES in src/main/bundled-keys.ts.
// Set ANISTREAM_APP_KEYS_REQUIRED=true to fail when the TMDB token is missing (release builds).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export const KEY_NAMES = ["ANISTREAM_TMDB_ACCESS_TOKEN", "ANISTREAM_MAL_CLIENT_ID"];
const OUTPUT = "app-keys.local.json";
const REQUIRED = "ANISTREAM_TMDB_ACCESS_TOKEN";

function readDotEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    let value = line.slice(separator + 1).trim();
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

const dotEnv = readDotEnv(".env");
const keys = {};
for (const name of KEY_NAMES) {
  const value = (process.env[name] || dotEnv[name] || "").trim();
  if (value) keys[name] = value;
}

const found = Object.keys(keys);
if (found.length > 0) {
  writeFileSync(OUTPUT, `${JSON.stringify(keys, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT} with: ${found.join(", ")}`);
} else {
  // Never ship a stale key file from an earlier build.
  rmSync(OUTPUT, { force: true });
}

if (!keys[REQUIRED]) {
  const message = `${REQUIRED} is not set; the packaged More section will show its setup screen.`;
  if (process.env.ANISTREAM_APP_KEYS_REQUIRED === "true") {
    console.error(`::error::${message}`);
    process.exit(1);
  }
  console.warn(`::warning::${message}`);
}
