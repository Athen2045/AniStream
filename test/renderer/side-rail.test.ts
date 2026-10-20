import { BookOpen, Bug, Search, Settings, Tv, UserRound } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OPEN_INTENT_MS, SideRail } from "../../src/renderer/src/SideRail";

const noop = (): void => undefined;

function render(): string {
  return renderToStaticMarkup(
    createElement(SideRail, {
      reducedMotion: true,
      onHome: noop,
      sections: [
        { key: "search", label: "Search", icon: Search, onSelect: noop },
        { key: "anime", label: "Anime", icon: Tv, active: true, onSelect: noop },
        { key: "manga", label: "Manga", icon: BookOpen, onSelect: noop },
      ],
      tools: [],
      footer: [
        { key: "report-bug", label: "Report a bug", icon: Bug, onSelect: noop },
        {
          key: "profile",
          label: "Ash",
          icon: UserRound,
          imageUrl: "https://s4.anilist.co/avatar.png",
          ariaLabel: "Your profile",
          onSelect: noop,
        },
        { key: "settings", label: "Settings", icon: Settings, badge: 120, onSelect: noop },
      ],
    }),
  );
}

describe("side rail", () => {
  it("renders closed, with the current section marked and labels for screen readers", () => {
    const html = render();
    expect(html).toContain('class="side-rail"');
    expect(html).not.toContain("is-open");
    expect(html).toMatch(/aria-label="Anime" aria-current="page"/);
    expect(html).toContain('aria-label="Report a bug"');
    expect(html).toContain("99+");
  });

  it("shows the profile picture in place of its icon, and keeps Report a bug above it", () => {
    const html = render();
    expect(html).toContain('class="side-rail-avatar" src="https://s4.anilist.co/avatar.png"');
    expect(html.indexOf("Report a bug")).toBeLessThan(html.indexOf("Your profile"));
    expect(html.indexOf("Your profile")).toBeLessThan(html.lastIndexOf('aria-label="Settings"'));
  });

  it("waits three seconds of resting before opening", () => {
    expect(OPEN_INTENT_MS).toBe(3_000);
  });
});
