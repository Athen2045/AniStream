import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_KEY_NAMES, loadBundledKeys } from "../../src/main/bundled-keys";

const TRACKED = [...BUNDLED_KEY_NAMES, "ANISTREAM_MANGABAKA_TOKEN", "ELECTRON_RENDERER_URL"];

describe("loadBundledKeys", () => {
  let directory: string;
  let file: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "anistream-keys-"));
    file = join(directory, "app-keys.local.json");
    for (const name of TRACKED) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    for (const name of TRACKED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    vi.restoreAllMocks();
  });

  it("applies allowlisted keys when the environment has none", () => {
    writeFileSync(
      file,
      JSON.stringify({
        ANISTREAM_TMDB_ACCESS_TOKEN: " tmdb-token ",
        ANISTREAM_MAL_CLIENT_ID: "mal-id",
      }),
    );
    expect(loadBundledKeys(file)).toEqual([
      "ANISTREAM_TMDB_ACCESS_TOKEN",
      "ANISTREAM_MAL_CLIENT_ID",
    ]);
    expect(process.env.ANISTREAM_TMDB_ACCESS_TOKEN).toBe("tmdb-token");
    expect(process.env.ANISTREAM_MAL_CLIENT_ID).toBe("mal-id");
  });

  it("never overrides a value the user already configured", () => {
    process.env.ANISTREAM_TMDB_ACCESS_TOKEN = "user-token";
    writeFileSync(file, JSON.stringify({ ANISTREAM_TMDB_ACCESS_TOKEN: "bundled-token" }));
    expect(loadBundledKeys(file)).toEqual([]);
    expect(process.env.ANISTREAM_TMDB_ACCESS_TOKEN).toBe("user-token");
  });

  it("fills a key the user left blank", () => {
    process.env.ANISTREAM_TMDB_ACCESS_TOKEN = "  ";
    writeFileSync(file, JSON.stringify({ ANISTREAM_TMDB_ACCESS_TOKEN: "bundled-token" }));
    expect(loadBundledKeys(file)).toEqual(["ANISTREAM_TMDB_ACCESS_TOKEN"]);
    expect(process.env.ANISTREAM_TMDB_ACCESS_TOKEN).toBe("bundled-token");
  });

  it("ignores names outside the allowlist and malformed values", () => {
    writeFileSync(
      file,
      JSON.stringify({
        ANISTREAM_MANGABAKA_TOKEN: "mb-personal",
        ELECTRON_RENDERER_URL: "https://attacker.example/",
        ANISTREAM_TMDB_ACCESS_TOKEN: "line\nbreak",
        ANISTREAM_MAL_CLIENT_ID: 42,
      }),
    );
    expect(loadBundledKeys(file)).toEqual([]);
    expect(process.env.ANISTREAM_MANGABAKA_TOKEN).toBeUndefined();
    expect(process.env.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(process.env.ANISTREAM_TMDB_ACCESS_TOKEN).toBeUndefined();
    expect(process.env.ANISTREAM_MAL_CLIENT_ID).toBeUndefined();
  });

  it("does nothing when the file is missing", () => {
    expect(loadBundledKeys(join(directory, "absent.json"))).toEqual([]);
  });

  it("warns and ignores unreadable or non-object files", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeFileSync(file, "{not json");
    expect(loadBundledKeys(file)).toEqual([]);
    writeFileSync(file, JSON.stringify(["ANISTREAM_TMDB_ACCESS_TOKEN"]));
    expect(loadBundledKeys(file)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("matches the build script's key list", () => {
    const script = readFileSync(join(__dirname, "../../scripts/write-app-keys.mjs"), "utf8");
    const listed = /KEY_NAMES = (\[[^\]]*\])/u.exec(script)?.[1];
    expect(listed && JSON.parse(listed)).toEqual([...BUNDLED_KEY_NAMES]);
  });
});
