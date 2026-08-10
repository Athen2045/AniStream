import { existsSync } from "node:fs";
import { posix, resolve } from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const defaultCandidates = [
  "dist/win-unpacked/resources/app.asar",
  "dist/mac-arm64/AniStream.app/Contents/Resources/app.asar",
];
const asarPath = resolve(
  process.argv[2] ??
    defaultCandidates.find((candidate) => existsSync(candidate)) ??
    defaultCandidates[0],
);

if (!existsSync(asarPath)) {
  throw new Error(`Packaged ASAR does not exist: ${asarPath}`);
}

const packageEntries = listPackage(asarPath);
const normalizedEntries = new Map(
  packageEntries.map((entry) => [
    entry.replaceAll("\\", "/").replace(/^\\?\//, ""),
    entry.replace(/^[/\\]/, ""),
  ]),
);
const mainEntry = normalizedEntries.get("out/main/index.js");
if (!mainEntry) throw new Error("Packaged ASAR does not contain out/main/index.js.");
const mainBundle = extractFile(asarPath, mainEntry).toString("utf8");
const preloadMatch = mainBundle.match(
  /preload:\s*join\(__dirname,\s*["'](\.\.\/preload\/[^"']+)["']\)/,
);

if (!preloadMatch) {
  throw new Error("Could not determine the packaged preload path from the main bundle.");
}

const requestedPreload = posix.normalize(posix.join("/out/main", preloadMatch[1]));
const packagedFiles = new Set(normalizedEntries.keys());
const normalizedPreload = requestedPreload.slice(1).replaceAll("\\", "/");

if (!packagedFiles.has(normalizedPreload)) {
  throw new Error(
    `Packaged main requests ${requestedPreload}, but that file is absent from app.asar.`,
  );
}

const preloadEntry = normalizedEntries.get(normalizedPreload);
if (!preloadEntry)
  throw new Error(`Packaged preload ${normalizedPreload} is absent from app.asar.`);
const preloadBundle = extractFile(asarPath, preloadEntry).toString("utf8");
if (!requestedPreload.endsWith(".cjs") || /^\s*import\s/m.test(preloadBundle)) {
  throw new Error(
    `Sandboxed preload ${requestedPreload} is emitted as ESM; it must be a CommonJS .cjs bundle.`,
  );
}

console.log(`Verified packaged preload: ${requestedPreload}`);
