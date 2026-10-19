import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsView, type SettingsTab } from "../../src/renderer/src/SettingsView";
import { UpdateProvider } from "../../src/renderer/src/AppUpdates";

function renderSettings(initialTab?: SettingsTab): string {
  return renderToStaticMarkup(
    React.createElement(UpdateProvider, {
      bridge: {
        getUpdateStatus: async () => ({ kind: "idle", currentVersion: "0.1.7" }),
        checkForUpdates: async () => ({ kind: "idle", currentVersion: "0.1.7" }),
        onUpdateStatusChanged: () => () => undefined,
      },
      children: React.createElement(SettingsView, {
        access: { kind: "guest" },
        onSignIn: vi.fn(),
        onOpenProfile: vi.fn(),
        onLogout: vi.fn(),
        initialTab,
      }),
    }),
  );
}

describe("SettingsView", () => {
  it("lists every tab and opens Account first, on its own", () => {
    const markup = renderSettings();
    for (const tab of [
      "Account",
      "General",
      "For You",
      "Playback",
      "Reading",
      "Backup &amp; updates",
    ])
      expect(markup).toContain(`${tab}</button>`);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Connect AniList");
    expect(markup).toContain("Connect Simkl");
    // Other tabs' settings are not on the page until their tab is chosen.
    expect(markup).not.toContain("Reduce motion");
    expect(markup).not.toContain("Page width");
  });

  it.each([
    [
      "general",
      [
        "Open on",
        "Up Next &amp; Playlists",
        "Airing schedule",
        "Latest Updates",
        "Rotating highlights",
        "Reduce motion",
      ],
    ],
    ["for-you", ["For You", "Learn from my activity", "Hidden genres &amp; tags", "Open graph"]],
    ["playback", ["Audio"]],
    ["reading", ["Page width", "Image fit", "Image quality", "Standard image port only"]],
    ["data", ["Check now", "Back up this device", "Export", "Restore"]],
  ] as const)("shows the %s tab's own settings", (tab, options) => {
    const markup = renderSettings(tab);
    for (const option of options) expect(markup).toContain(option);
    expect(markup).not.toContain("Connect AniList");
  });

  it("uses switches for on/off settings", () => {
    expect(renderSettings("general")).toContain('role="switch"');
  });
});
