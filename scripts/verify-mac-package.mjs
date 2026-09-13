import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackagedBuild } from "./lib/packaged-build.mjs";

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
}
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function verifyApp(appPath, root) {
  const resources = join(appPath, "Contents/Resources");
  const asar = join(resources, "app.asar");
  const result = verifyPackagedBuild(asar, root);
  run(process.execPath, [join(root, "scripts/verify-packaged-preload.mjs"), asar]);
  const plist = join(appPath, "Contents/Info.plist");
  const field = (key) => run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
  if (
    field("CFBundleIdentifier") !== "dev.anistream.desktop" ||
    field("CFBundleExecutable") !== "AniStream" ||
    field("CFBundleShortVersionString") !== result.version
  ) {
    throw new Error("Mac bundle identity or version differs from the release candidate.");
  }
  const urlTypes = JSON.parse(
    run("/usr/bin/plutil", ["-extract", "CFBundleURLTypes", "json", "-o", "-", plist]),
  );
  if (
    !Array.isArray(urlTypes) ||
    !urlTypes.some((type) => type.CFBundleURLSchemes?.includes("anistream"))
  ) {
    throw new Error("Mac bundle is missing the AniList callback scheme.");
  }
  const binaries = [
    join(appPath, "Contents/MacOS/AniStream"),
    join(appPath, "Contents/Frameworks/Electron Framework.framework/Electron Framework"),
    join(resources, "app.asar.unpacked", result.sqliteRelativePath),
  ];
  for (const binary of binaries) {
    if (run("/usr/bin/lipo", ["-archs", binary]) !== "arm64") {
      throw new Error(`Expected an arm64-only native binary: ${basename(binary)}`);
    }
  }
  const nativeSha256 = [];
  for (const binary of binaries) nativeSha256.push(await sha256(binary));
  return { ...result, nativeSha256 };
}

export async function verifyMacPackage(args = process.argv.slice(2)) {
  if (process.platform !== "darwin")
    throw new Error(
      "Mac package verification requires macOS with hdiutil, plutil and lipo. No native checks ran.",
    );
  if (args.length > 2 || args.some((arg) => arg.startsWith("--")))
    throw new Error(
      "Usage: npm run check:mac-package -- [AniStream.app] [AniStream-X.Y.Z-arm64.dmg]",
    );
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const appPath = resolve(args[0] ?? join(root, "dist/mac-arm64/AniStream.app"));
  const dmgPath = resolve(args[1] ?? join(root, `dist/AniStream-${version}-arm64.dmg`));
  if (
    basename(dmgPath) !== `AniStream-${version}-arm64.dmg` ||
    !statSync(dmgPath).isFile() ||
    statSync(dmgPath).size === 0
  ) {
    throw new Error("Expected a nonempty DMG with the release version and arm64 filename.");
  }
  const built = await verifyApp(appPath, root);
  run("/usr/bin/hdiutil", ["verify", dmgPath]);
  const mount = mkdtempSync(join(tmpdir(), "anistream-dmg-check-"));
  let mounted = false;
  let attachAttempted = false;
  try {
    attachAttempted = true;
    run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmgPath]);
    mounted = true;
    const apps = readdirSync(mount).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1 || apps[0] !== "AniStream.app")
      throw new Error("DMG must contain exactly one AniStream.app.");
    const shippedApp = join(mount, "AniStream.app");
    const shipped = await verifyApp(shippedApp, root);
    if (
      shipped.buildSha256 !== built.buildSha256 ||
      JSON.stringify(shipped.nativeSha256) !== JSON.stringify(built.nativeSha256) ||
      (await sha256(join(shippedApp, "Contents/Resources/app.asar"))) !==
        (await sha256(join(appPath, "Contents/Resources/app.asar")))
    ) {
      throw new Error(
        "DMG application code or native binaries differ from the verified unpacked application.",
      );
    }
    return {
      version,
      architecture: "arm64",
      buildFiles: built.buildFiles,
      buildSha256: built.buildSha256,
      dmg: basename(dmgPath),
      dmgSha256: await sha256(dmgPath),
      packageIntegrity: "passed",
      signing: "not assessed",
      nativeInteraction: "not assessed",
    };
  } finally {
    // An interrupted attach may still have mounted the volume. Never remove a possibly live mount.
    if (mounted) {
      run("/usr/bin/hdiutil", ["detach", mount]);
      rmdirSync(mount);
    } else if (!attachAttempted) rmdirSync(mount);
    else
      process.stderr.write(
        `Attach did not complete. Inspect ${mount} with hdiutil info before removing the empty mount directory.\n`,
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifyMacPackage(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Mac package verification failed.");
    process.exitCode = 1;
  }
}
