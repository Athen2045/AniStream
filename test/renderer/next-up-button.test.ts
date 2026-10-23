import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextUpButton } from "../../src/renderer/src/player/NextUpButton";

function render(remaining?: number): string {
  return renderToStaticMarkup(
    createElement(NextUpButton, {
      heading: "Next episode",
      title: "E2 · The Hero of the South",
      remaining,
      total: 5,
      onPlay: vi.fn(),
      onCancel: vi.fn(),
    }),
  );
}

describe("NextUpButton", () => {
  it("counts down in the Skip style, its fill following the countdown, with Cancel", () => {
    const markup = render(2);
    expect(markup).toContain('class="vplayer-skip"');
    expect(markup).toContain("--skip-progress:0.6");
    expect(markup).toContain('aria-label="Next episode in 2: E2 · The Hero of the South"');
    expect(markup).toContain('aria-label="Cancel autoplay"');
  });

  it("is just the button when autoplay is off or cancelled", () => {
    const markup = render(undefined);
    expect(markup).toContain('aria-label="Next episode: E2 · The Hero of the South"');
    expect(markup).toContain("--skip-progress:0");
    expect(markup).not.toContain("Cancel autoplay");
  });
});
