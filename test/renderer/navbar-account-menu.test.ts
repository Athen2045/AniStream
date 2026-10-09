import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NavbarAccountMenu,
  NavbarAccountMenuPanel,
  type NavbarAccountMenuProps,
} from "../../src/renderer/src/NavbarAccountMenu";

function renderPanel(props: NavbarAccountMenuProps): string {
  return renderToStaticMarkup(
    React.createElement(NavbarAccountMenuPanel, {
      ...props,
      id: "account-menu",
      onClose: vi.fn(),
    }),
  );
}

describe("navbar account menu", () => {
  it("keeps the signed-in avatar inside a circular trigger without a chevron", () => {
    const markup = renderToStaticMarkup(
      React.createElement(NavbarAccountMenu, {
        kind: "member",
        name: "Athen101",
        avatarUrl: "https://example.test/avatar.jpg",
        onOpenProfile: vi.fn(),
        onOpenSettings: vi.fn(),
        onLogout: vi.fn(),
      }),
    );

    expect(markup).toContain("account-menu-trigger--member");
    expect(markup).toContain('src="https://example.test/avatar.jpg"');
    expect(markup).not.toContain("account-menu-chevron");
  });

  it("shows guest settings and sign-in actions", () => {
    const markup = renderPanel({
      kind: "guest",
      onOpenSettings: vi.fn(),
      onSignIn: vi.fn(),
    });

    expect(markup).toContain("Settings");
    expect(markup).toContain("Sign In");
    expect(markup).toContain("account-menu-accent");
    expect(markup).not.toContain("Log Out");
  });

  it("shows the connected identity, settings, and logout actions", () => {
    const markup = renderPanel({
      kind: "member",
      name: "Athen101",
      avatarUrl: "https://example.test/avatar.jpg",
      onOpenProfile: vi.fn(),
      onOpenSettings: vi.fn(),
      onLogout: vi.fn(),
    });

    expect(markup).toContain("Athen101");
    expect(markup).toContain("AniList profile");
    expect(markup).toContain("Settings");
    expect(markup).toContain("Log Out");
    expect(markup).not.toContain("Sign In");
  });

  it("puts Report a bug between Settings and the account action for guests and members", () => {
    const guest = renderPanel({ kind: "guest", onOpenSettings: vi.fn(), onSignIn: vi.fn() });
    const member = renderPanel({
      kind: "member",
      name: "Athen101",
      onOpenProfile: vi.fn(),
      onOpenSettings: vi.fn(),
      onLogout: vi.fn(),
    });

    for (const [markup, last] of [
      [guest, "Sign In"],
      [member, "Log Out"],
    ] as const) {
      const report = markup.indexOf("Report a bug");
      expect(report).toBeGreaterThan(markup.indexOf("Settings"));
      expect(report).toBeLessThan(markup.indexOf(last));
    }
  });
});
