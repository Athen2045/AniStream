import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProfileConnectView } from "../../src/renderer/src/ProfileConnectView";

describe("ProfileConnectView", () => {
  it("renders one focused AniList connection surface", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileConnectView, {
        auth: { status: "signed-out" },
        restoring: false,
        onConnect: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain("Make AniStream yours");
    expect(markup).toContain("Continue with AniList");
    expect(markup).toContain("macOS Keychain");
    expect(markup).not.toContain("Your watchlist, when you want it");
    expect(markup).not.toContain("profile-connect-capabilities");
  });

  it("announces the browser authorization state and offers cancellation", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileConnectView, {
        auth: { status: "authorizing" },
        restoring: false,
        onConnect: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(markup).toContain("AniList authorization is open in your browser");
    expect(markup).toContain("Finish in your browser");
    expect(markup).toContain("Cancel sign-in");
  });
});
