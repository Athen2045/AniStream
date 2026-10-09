import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/renderer/src/styles.css"), "utf8");
const titleStyles = readFileSync(resolve("src/renderer/src/styles/title.css"), "utf8");

describe("renderer visual motion regressions", () => {
  it("does not clip a horizontal fade inside the short Profile/title banner band", () => {
    // Profile, the catalog hero, and title pages share this 1900×400 band; its fade is vertical only.
    const bandFade = titleStyles.match(/\.title-band::after\s*\{(?<body>[\s\S]*?)\}/);

    expect(bandFade?.groups?.body).toBeDefined();
    expect(bandFade?.groups?.body).not.toContain("90deg");
  });

  it("does not add native smoothing or snap settling on top of animated rail scrolling", () => {
    const carouselViewport = styles.match(/\.carousel-viewport\s*\{(?<body>[\s\S]*?)\}/);

    expect(carouselViewport?.groups?.body).toContain("scroll-behavior: auto");
    expect(carouselViewport?.groups?.body).toContain("scroll-snap-type: none");
  });
});
