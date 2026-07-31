import { describe, expect, it } from "vitest";
import { rendererAssetCacheControl } from "../../src/main/renderer-server";

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
