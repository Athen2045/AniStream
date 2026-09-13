import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createPackageWithOptions, uncache } from "@electron/asar";
import { expect, it } from "vitest";
import { verifyPackagedBuild } from "../../scripts/lib/packaged-build.mjs";

async function fixture(change: (source: string, project: string) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "anistream-package-test-"));
  const source = join(dir, "source"),
    project = join(dir, "project"),
    archive = join(dir, "app.asar");
  const write = (root: string, name: string, content: string) => {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), content);
  };
  const pkg = JSON.stringify({
    name: "anistream",
    version: "0.1.3",
    main: "./out/main/index.js",
    type: "module",
  });
  for (const root of [source, project]) {
    write(root, "package.json", pkg);
    write(root, "out/main/index.js", "main bundle");
    write(root, "out/preload/index.cjs", "preload bundle");
    write(root, "out/renderer/index.html", "<html></html>");
    write(root, "out/renderer/assets/reader.js", "reader bundle");
  }
  write(
    source,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "fixture native bytes",
  );
  try {
    change(source, project);
    await createPackageWithOptions(source, archive, { unpack: "**/*.node" });
    return { result: () => verifyPackagedBuild(archive, project), cleanup: () => clean() };
  } catch (error) {
    clean();
    throw error;
  }
  function clean() {
    uncache(archive);
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("anistream-package-test-"))
      throw new Error("Unsafe test cleanup path");
    rmSync(target, { recursive: true, force: true });
  }
}

it("verifies an actual ASAR against the fresh output and produces a stable build digest", async () => {
  const f = await fixture();
  try {
    const result = f.result();
    expect(result).toMatchObject({
      version: "0.1.3",
      buildFiles: 4,
      buildSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(f.result()).toEqual(result);
  } finally {
    f.cleanup();
  }
});
it.each(["version", "main", "name", "type"])("rejects a packaged %s mismatch", async (field) => {
  const f = await fixture((source) => {
    const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    pkg[field] = "different";
    writeFileSync(join(source, "package.json"), JSON.stringify(pkg));
  });
  try {
    expect(f.result).toThrow(/differs from package.json/);
  } finally {
    f.cleanup();
  }
});
it("detects stale main code even when the package version is unchanged", async () => {
  const f = await fixture((source) =>
    writeFileSync(join(source, "out/main/index.js"), "old bundle"),
  );
  try {
    expect(f.result).toThrow(/differs from fresh output/);
  } finally {
    f.cleanup();
  }
});
it("detects missing lazy chunks", async () => {
  const f = await fixture((source) => rmSync(join(source, "out/renderer/assets/reader.js")));
  try {
    expect(f.result).toThrow(/missing out\/renderer\/assets\/reader.js/);
  } finally {
    f.cleanup();
  }
});
it("detects leftover assets from an older build", async () => {
  const f = await fixture((source) =>
    writeFileSync(join(source, "out/renderer/assets/stale.js"), "old"),
  );
  try {
    expect(f.result).toThrow(/stale build output/);
  } finally {
    f.cleanup();
  }
});
it("requires a fresh preload before assessing the package", async () => {
  const f = await fixture((_source, project) => rmSync(join(project, "out/preload/index.cjs")));
  try {
    expect(f.result).toThrow(/Fresh build is missing/);
  } finally {
    f.cleanup();
  }
});
it.each([".env", ".env.local", "personal.sqlite", "signing.p12"])(
  "rejects accidentally packaged %s",
  async (name) => {
    const f = await fixture((source) => writeFileSync(join(source, name), "fixture only"));
    try {
      expect(f.result).toThrow(/forbidden local-data or credential file/);
    } finally {
      f.cleanup();
    }
  },
);
it("rejects a missing native SQLite binary", async () => {
  const f = await fixture((source) =>
    rmSync(join(source, "node_modules/better-sqlite3/build/Release/better_sqlite3.node")),
  );
  try {
    expect(f.result).toThrow(/SQLite native module/);
  } finally {
    f.cleanup();
  }
});

it("accepts the host prebuild used by current better-sqlite3 releases", async () => {
  const f = await fixture((source) => {
    rmSync(join(source, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"));
    mkdirSync(join(source, "node_modules/better-sqlite3/prebuilds"), { recursive: true });
    writeFileSync(
      join(
        source,
        `node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`,
      ),
      "fixture prebuild bytes",
    );
  });
  try {
    expect(f.result().sqliteRelativePath).toBe(
      `node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`,
    );
  } finally {
    f.cleanup();
  }
});
