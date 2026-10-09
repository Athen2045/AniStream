import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/renderer/src/SettingsView";
import { UpdateProvider } from "../../src/renderer/src/AppUpdates";

function renderSettings(props: React.ComponentProps<typeof SettingsView>): string {
  return renderToStaticMarkup(
    React.createElement(UpdateProvider, {
      bridge: {
        getUpdateStatus: async () => ({ kind: "idle", currentVersion: "0.1.7" }),
        checkForUpdates: async () => ({ kind: "idle", currentVersion: "0.1.7" }),
        onUpdateStatusChanged: () => () => undefined,
      },
      children: React.createElement(SettingsView, props),
    }),
  );
}

describe("SettingsView", () => {
  it("groups every setting into focused sections", () => {
    const markup = renderSettings({
      access: { kind: "guest" },
      onSignIn: vi.fn(),
      onOpenProfile: vi.fn(),
      onLogout: vi.fn(),
    });

    for (const heading of ["Account", "Customize app", "Playback", "Reading", "Backup", "Updates"])
      expect(markup).toContain(`>${heading}</h2>`);
    for (const option of [
      "Up Next &amp; Playlists",
      "Airing schedule",
      "For You",
      "Rotating highlights",
      "Reduce motion",
      "Open on",
      "Audio",
      "Page width",
      "Standard image port only",
    ])
      expect(markup).toContain(option);
    expect(markup).toContain("Connect AniList");
    expect(markup).toContain("Connect Simkl");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain("Check for updates");
  });
});
