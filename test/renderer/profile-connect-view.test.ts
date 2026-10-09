import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProfileConnectView } from "../../src/renderer/src/ProfileConnectView";
import { UpdateProvider } from "../../src/renderer/src/AppUpdates";

function renderProfile(props: React.ComponentProps<typeof ProfileConnectView>): string {
  return renderToStaticMarkup(
    React.createElement(UpdateProvider, {
      bridge: {
        getUpdateStatus: async () => ({ kind: "idle", currentVersion: "0.1.3" }),
        checkForUpdates: async () => ({ kind: "idle", currentVersion: "0.1.3" }),
        onUpdateStatusChanged: () => () => undefined,
      },
      children: React.createElement(ProfileConnectView, props),
    }),
  );
}

describe("ProfileConnectView", () => {
  it("renders one focused AniList connection surface", () => {
    const markup = renderProfile({
      auth: { status: "signed-out" },
      restoring: false,
      onConnect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(markup).toContain("Make AniStream yours");
    expect(markup).toContain("Connect AniList");
    expect(markup).toContain("Connect Simkl");
    expect(markup).toContain('class="profile-connect-app-icon"');
    expect(markup).toContain('aria-label="AniList"');
    expect(markup).not.toContain("No AniList password or Developer API setup is required");
    expect(markup).not.toContain("Local progress and backups");
    expect(markup).not.toContain("App updates");
    expect(markup).not.toContain("Your watchlist, when you want it");
    expect(markup).not.toContain("profile-connect-capabilities");
  });

  it("announces the browser authorization state and offers cancellation", () => {
    const markup = renderProfile({
      auth: { status: "authorizing" },
      restoring: false,
      onConnect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(markup).toContain("AniList authorization is open in your browser");
    expect(markup).toContain("Finish in your browser");
    expect(markup).toContain("Open AniList again");
    expect(markup).toContain("Cancel sign-in");
    expect(markup).not.toContain("Connect AniList");
  });

  it("offers guest browsing and says the password stays with AniList", () => {
    const markup = renderProfile({
      auth: { status: "signed-out" },
      restoring: false,
      onConnect: vi.fn(),
      onCancel: vi.fn(),
      onBrowse: vi.fn(),
    });

    expect(markup).toContain("Browse as guest");
    expect(markup).toContain("AniStream never sees your password");
  });
});
