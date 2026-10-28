import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads the small set of local development/runtime settings used by the main process.
 * Existing shell variables win over file values so launchers and CI stay authoritative.
 */
export function loadEnvironmentFile(path: string): void {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * The `.env` files to load, in precedence order. The working-directory file is a development
 * convenience only: an installed app can be started from any folder, and a `.env` planted there
 * must not set keys or tuning. The user-data file is the user's own and always applies.
 */
export function environmentFiles(input: {
  packaged: boolean;
  cwd: string;
  userData: string;
}): string[] {
  return [...(input.packaged ? [] : [join(input.cwd, ".env")]), join(input.userData, ".env")];
}
