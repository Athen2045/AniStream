import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const requestedVersion = process.argv[2]?.trim();
if (!requestedVersion || !/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
  throw new Error("Usage: node scripts/verify-release-version.mjs <semver-version>");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (packageJson.version !== requestedVersion) {
  throw new Error(
    `package.json is ${packageJson.version}, but the requested release is ${requestedVersion}. Bump the package version on main first.`,
  );
}

const releaseNotesPath = `docs/releases/v${requestedVersion}.md`;
await access(releaseNotesPath);

const existingTags = execFileSync("git", ["tag", "--list", `v${requestedVersion}`], {
  encoding: "utf8",
}).trim();
if (existingTags) throw new Error(`Tag v${requestedVersion} already exists; choose a new version.`);

function versionParts(version) {
  return version.split(".").map(Number);
}

const latestTag = execFileSync("git", ["tag", "--list", "v*.*.*", "--sort=-version:refname"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .find(Boolean);
if (latestTag) {
  const [major, minor, patch] = versionParts(latestTag.slice(1));
  const [nextMajor, nextMinor, nextPatch] = versionParts(requestedVersion);
  if (
    nextMajor < major ||
    (nextMajor === major && nextMinor < minor) ||
    (nextMajor === major && nextMinor === minor && nextPatch <= patch)
  ) {
    throw new Error(`v${requestedVersion} must be newer than the latest tag ${latestTag}.`);
  }
}

console.log(`Release ${requestedVersion} is ready: package version, notes, and tag are valid.`);
