import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { verifyPackagedBuild } from "./lib/packaged-build.mjs";

const candidates = [
  "dist/win-unpacked/resources/app.asar",
  "dist/mac-arm64/AniStream.app/Contents/Resources/app.asar",
];
const asarPath = resolve(
  process.argv[2] ?? candidates.find((candidate) => existsSync(candidate)) ?? candidates[0],
);

if (!existsSync(asarPath)) throw new Error(`Packaged ASAR does not exist: ${asarPath}`);

console.log(JSON.stringify(verifyPackagedBuild(asarPath, process.cwd()), null, 2));
