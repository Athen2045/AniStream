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
      {
        id: "local",
        label: "Opening local data",
        shortLabel: "Local data",
        weight: 15,
        state: "complete",
      },
      {
        id: "catalog",
        label: "Checking AniList catalog",
        shortLabel: "AniList",
        weight: 40,
        state: "active",
      },
    ],
    outcome: "checking",
    canContinue: false,
    ...overrides,
  };
}

describe("ReadinessScreen", () => {
  it("starts with only the app mark, so a fast launch never flashes a loader", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReadinessScreen, {
        snapshot: snapshot(),
        reducedMotion: false,
        onRetry: vi.fn(),
        onContinue: vi.fn(),
      }),
    );

    expect(markup).toContain("readiness-mark");
    expect(markup).toContain("AniStream");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("chromevt");
    // Status, steps and the stream line appear only after READINESS_DETAIL_DELAY_MS.
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain("readiness-steps");
  });

  it("announces failures and exposes only valid recovery actions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReadinessScreen, {
        snapshot: snapshot({
          outcome: "degraded",
          progress: 80,
          activeLabel: "Readiness check needs attention",
          message: "Sorry, playback is unavailable.",
          provider: "The anime player",
          canContinue: true,
        }),
        reducedMotion: true,
        onRetry: vi.fn(),
        onContinue: vi.fn(),
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Try again");
    expect(markup).toContain("Continue browsing");
    expect(markup).toContain("Sorry, playback is unavailable.");
    // A failure shows the steps at once, with the failed one marked.
    expect(markup).toContain("readiness-steps");
    expect(markup).toContain("is-complete");
    expect(markup).not.toContain('role="progressbar"');
  });

  it("names the service that is not answering", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReadinessScreen, {
        snapshot: snapshot({ outcome: "provider-error", provider: "AniList", message: "x" }),
        reducedMotion: false,
        onRetry: vi.fn(),
        onContinue: vi.fn(),
      }),
    );
    expect(markup).toContain("AniList isn&#x27;t answering right now");
  });
});
