import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src/renderer/src/styles.css"), "utf8");

describe("renderer visual motion regressions", () => {
  it("does not clip a horizontal Windows fade inside the short Profile bottom overlay", () => {
    const windowsProfileFade = styles.match(
      /html\[data-platform="win32"\] \.profile-hero::after\s*\{(?<body>[\s\S]*?)\}/,
    );

    expect(windowsProfileFade?.groups?.body).toBeDefined();
    expect(windowsProfileFade?.groups?.body).not.toContain("90deg");
  });

  it("does not add native smoothing or snap settling on top of animated rail scrolling", () => {
    const carouselViewport = styles.match(/\.carousel-viewport\s*\{(?<body>[\s\S]*?)\}/);

    expect(carouselViewport?.groups?.body).toContain("scroll-behavior: auto");
    expect(carouselViewport?.groups?.body).toContain("scroll-snap-type: none");
  });
});
