import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NavbarAccountMenu,
  NavbarAccountMenuPanel,
  type NavbarAccountMenuProps,
} from "../../src/renderer/src/NavbarAccountMenu";
import { NotificationBellIcon } from "../../src/renderer/src/ReleaseNotifications";

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

  it("uses the requested normal and unread notification artwork", () => {
    const normal = renderToStaticMarkup(
      React.createElement(NotificationBellIcon, { unread: false }),
    );
    const unread = renderToStaticMarkup(
      React.createElement(NotificationBellIcon, { unread: true }),
    );

    expect(normal).toContain('viewBox="0 0 24 24"');
    expect(normal).toContain("M18 8C18 6.4087");
    expect(unread).toContain("M18 8V2M15 5H21");
    expect(normal).not.toEqual(unread);
  });
});
