import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractFile, listPackage, statFile } from "@electron/asar";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function filesUnder(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Build output must not contain links: ${path}`);
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

/** Compare the shipped code and assets to this checkout's fresh build, without executing either. */
export function verifyPackagedBuild(asarPath, projectRoot) {
  const expected = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expected.version)) {
    throw new Error("The release candidate must have a stable package version.");
  }
  const entries = new Map(
    listPackage(asarPath).map((entry) => [
      entry.replaceAll("\\", "/").replace(/^\//, ""),
      entry.replace(/^[/\\]/, ""),
    ]),
  );
  const read = (path) => {
    const entry = entries.get(path);
    if (!entry) throw new Error(`Package is missing ${path}.`);
    const metadata = statFile(asarPath, entry, false);
    if ("link" in metadata || "files" in metadata)
      throw new Error(`Expected a regular packaged file: ${path}`);
    return extractFile(asarPath, entry);
  };
  const packaged = JSON.parse(read("package.json").toString("utf8"));
  if (
    packaged.name !== expected.name ||
    packaged.version !== expected.version ||
    packaged.main !== expected.main ||
    packaged.type !== expected.type
  ) {
    throw new Error(
      "Packaged name, version, entry point or module type differs from package.json.",
    );
  }
  // Node dependencies may carry fixtures; app data and local environment files never belong here.
  for (const path of entries.keys()) {
    if (path.startsWith("node_modules/")) continue;
    if (/(^|\/)(\.env(?:\.[^/]*)?|[^/]+\.(?:sqlite(?:-wal|-shm)?|db|pem|p12|pfx))$/i.test(path)) {
      throw new Error(`Package contains a forbidden local-data or credential file: ${path}`);
    }
  }
  const expectedFiles = filesUnder(join(projectRoot, "out")).map((path) => `out/${path}`);
  for (const required of [
    "out/main/index.js",
    "out/preload/index.cjs",
    "out/renderer/index.html",
  ]) {
    if (!expectedFiles.includes(required))
      throw new Error(`Fresh build is missing ${required}; run npm run build.`);
  }
  const expectedSet = new Set(expectedFiles);
  for (const path of entries.keys()) {
    if (!path.startsWith("out/")) continue;
    const metadata = statFile(asarPath, entries.get(path), false);
    if (!("files" in metadata) && !expectedSet.has(path))
      throw new Error(`Package contains stale build output: ${path}`);
  }
  const manifest = createHash("sha256");
  for (const path of expectedFiles.sort()) {
    const digest = hash(read(path));
    if (digest !== hash(readFileSync(join(projectRoot, path))))
      throw new Error(`Packaged build differs from fresh output: ${path}`);
    manifest.update(`${path}\0${digest}\n`);
  }
  const sqliteCandidates = [
    `node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  ];
  const sqlite = sqliteCandidates.find((candidate) => {
    const entry = entries.get(candidate);
    return entry !== undefined && statFile(asarPath, entry).unpacked === true;
  });
  if (!sqlite) {
    throw new Error("The SQLite native module must be present and unpacked.");
  }
  return {
    version: expected.version,
    buildFiles: expectedFiles.length,
    buildSha256: manifest.digest("hex"),
    sqliteRelativePath: sqlite,
  };
}
