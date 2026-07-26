import { existsSync } from "node:fs";
import { posix, resolve } from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const asarPath = resolve(
  process.argv[2] ?? "dist/mac-arm64/AniStream.app/Contents/Resources/app.asar",
);

if (!existsSync(asarPath)) {
  throw new Error(`Packaged ASAR does not exist: ${asarPath}`);
}

const mainBundle = extractFile(asarPath, "out/main/index.js").toString("utf8");
const preloadMatch = mainBundle.match(
  /preload:\s*join\(__dirname,\s*["'](\.\.\/preload\/[^"']+)["']\)/,
);

if (!preloadMatch) {
  throw new Error("Could not determine the packaged preload path from the main bundle.");
}

const requestedPreload = posix.normalize(posix.join("/out/main", preloadMatch[1]));
const packagedFiles = new Set(listPackage(asarPath));

if (!packagedFiles.has(requestedPreload)) {
  throw new Error(
    `Packaged main requests ${requestedPreload}, but that file is absent from app.asar.`,
  );
}

const preloadBundle = extractFile(asarPath, requestedPreload.slice(1)).toString("utf8");
if (!requestedPreload.endsWith(".cjs") || /^\s*import\s/m.test(preloadBundle)) {
  throw new Error(
    `Sandboxed preload ${requestedPreload} is emitted as ESM; it must be a CommonJS .cjs bundle.`,
  );
}

console.log(`Verified packaged preload: ${requestedPreload}`);
