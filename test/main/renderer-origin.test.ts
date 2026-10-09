import { describe, expect, it } from "vitest";
import { resolveDevRendererUrl } from "../../src/main/renderer-origin";

describe("development renderer URL override", () => {
  it("ignores any override in packaged builds", () => {
    expect(
      resolveDevRendererUrl({ packaged: true, value: "http://localhost:5173" }),
    ).toBeUndefined();
    expect(
      resolveDevRendererUrl({ packaged: true, value: "https://attacker.example" }),
    ).toBeUndefined();
  });

  it("uses the built renderer server when no override is set", () => {
    expect(resolveDevRendererUrl({ packaged: false, value: undefined })).toBeUndefined();
    expect(resolveDevRendererUrl({ packaged: false, value: "  " })).toBeUndefined();
  });

  it("accepts the electron-vite loopback dev server", () => {
    expect(resolveDevRendererUrl({ packaged: false, value: "http://localhost:5173" })).toBe(
      "http://localhost:5173/",
    );
    expect(resolveDevRendererUrl({ packaged: false, value: "http://127.0.0.1:5173/" })).toBe(
      "http://127.0.0.1:5173/",
    );
    expect(resolveDevRendererUrl({ packaged: false, value: "http://[::1]:5173" })).toBe(
      "http://[::1]:5173/",
    );
  });

  it("refuses non-loopback, non-http, or credentialed development origins", () => {
    for (const value of [
      "https://attacker.example",
      "http://attacker.example:5173",
      "http://localhost.attacker.example",
      "http://127.0.0.2:5173",
      "https://localhost:5173",
      "file:///C:/renderer/index.html",
      "http://user:pass@localhost:5173",
      "not a url",
    ]) {
      expect(() => resolveDevRendererUrl({ packaged: false, value }), value).toThrow(
        /ELECTRON_RENDERER_URL/,
      );
    }
  });
});
