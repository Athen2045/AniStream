import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReadinessScreen } from "../../src/renderer/src/ReadinessScreen";
import type { ReadinessSnapshot } from "../../src/renderer/src/startup-readiness";

function snapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    attempt: 1,
    mode: "launch",
    progress: 65,
    activeLabel: "Checking AniList catalog",
    steps: [
      { id: "local", label: "Opening local data", weight: 15, state: "complete" },
      { id: "catalog", label: "Checking AniList catalog", weight: 40, state: "active" },
    ],
    outcome: "checking",
    canContinue: false,
    ...overrides,
  };
}

describe("ReadinessScreen", () => {
  it("renders local artwork and a determinate accessible progress state", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReadinessScreen, {
        snapshot: snapshot(),
        reducedMotion: false,
        onRetry: vi.fn(),
        onContinue: vi.fn(),
      }),
    );

    expect(markup).toContain("chromevt-vtuber.gif");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="65"');
    expect(markup).toContain("65%");
    expect(markup).toContain("Checking AniList catalog");
  });

  it("announces failures and exposes only valid recovery actions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReadinessScreen, {
        snapshot: snapshot({
          outcome: "degraded",
          progress: 80,
          activeLabel: "Readiness check needs attention",
          message: "Sorry, playback is unavailable.",
          canContinue: true,
        }),
        reducedMotion: true,
        onRetry: vi.fn(),
        onContinue: vi.fn(),
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry");
    expect(markup).toContain("Continue browsing");
    expect(markup).toContain("Sorry, playback is unavailable.");
  });
});
