import { describe, expect, it } from "vitest";
import { titleAccentStyle } from "../../src/renderer/src/title-accent";

describe("title accent", () => {
  it("picks the text color with the higher contrast on the accent", () => {
    // Coral: white would be about 2.6:1, near-black about 8:1.
    expect(titleAccentStyle("#fe7850")).toMatchObject({ "--title-accent-ink": "#0b0d0c" });
    expect(titleAccentStyle("#1a2b5e")).toMatchObject({ "--title-accent-ink": "#ffffff" });
  });

  it("lightens very dark accents used as text and ignores invalid colors", () => {
    expect(titleAccentStyle("#1a2b5e")).toMatchObject({
      "--title-accent-text": "color-mix(in srgb, #1a2b5e 45%, #ffffff)",
    });
    expect(titleAccentStyle("#f1c90d")).toMatchObject({ "--title-accent-text": "#f1c90d" });
    expect(titleAccentStyle("red; background: url(x)")).toBeUndefined();
    expect(titleAccentStyle(undefined)).toBeUndefined();
  });
});
