import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  rendererAssetCacheControl,
  startRendererServer,
} from "../../src/main/renderer-server";

describe("packaged renderer cache policy", () => {
  it("caches Vite-fingerprinted assets for immutable reuse", () => {
    expect(rendererAssetCacheControl("assets/index-hash.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(rendererAssetCacheControl("assets/index-hash.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("never gives the HTML entry point an immutable cache policy", () => {
    expect(rendererAssetCacheControl("index.html")).toBe("no-cache, no-store, must-revalidate");
  });
});

describe("renderer content security policy", () => {
  it("frames only the configured player origins", () => {
    expect(buildContentSecurityPolicy(["https://player.example"])).toContain(
      "frame-src https://player.example;",
    );
    expect(buildContentSecurityPolicy([])).toContain("frame-src 'none';");
    expect(buildContentSecurityPolicy([])).toContain("frame-ancestors 'none'");
  });
});

describe("renderer loopback port", () => {
  it("keeps the preferred port so saved renderer choices survive restarts, else falls back", async () => {
    const root = mkdtempSync(join(tmpdir(), "anistream-renderer-"));
    const first = await startRendererServer(root, { frameOrigins: [], port: 0 });
    const port = Number(new URL(first.origin).port);
    try {
      // The preferred port is taken: the second server still starts, on another port.
      const second = await startRendererServer(root, { frameOrigins: [], port });
      expect(second.origin).not.toBe(first.origin);
      await second.close();
    } finally {
      await first.close();
    }
    const again = await startRendererServer(root, { frameOrigins: [], port });
    expect(again.origin).toBe(`http://127.0.0.1:${port}`);
    await again.close();
  });
});
