import { BookOpen, Bug, CalendarDays, Search, Settings, Tv, UserRound } from "lucide-react";
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
      tools: [
        {
          key: "schedule",
          label: "Schedule",
          icon: CalendarDays,
          live: true,
          meta: "2 new",
          onSelect: noop,
        },
      ],
      footer: [
        { key: "report-bug", label: "Report a bug", icon: Bug, onSelect: noop },
        { key: "settings", label: "Settings", icon: Settings, onSelect: noop },
        {
          key: "profile",
          label: "Ash",
          sublabel: "AniList",
          icon: UserRound,
          imageUrl: "https://s4.anilist.co/avatar.png",
          ariaLabel: "Your profile",
          onSelect: noop,
        },
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
  });

  it("marks something new with the sky dot and a quiet count under a Library label", () => {
    const html = render();
    expect(html).toContain('class="side-rail-dot is-live"');
    expect(html).toContain('class="side-rail-meta is-live" aria-hidden="true">2 new');
    expect(html).toContain(">Library<");
  });

  it("ends with the profile: its picture in place of the icon and its tracker below the name", () => {
    const html = render();
    expect(html).toContain('class="side-rail-avatar" src="https://s4.anilist.co/avatar.png"');
    expect(html).toContain("<b>Ash</b><small>AniList</small>");
    expect(html.indexOf("Report a bug")).toBeLessThan(html.indexOf('aria-label="Settings"'));
    expect(html.indexOf('aria-label="Settings"')).toBeLessThan(html.indexOf("Your profile"));
  });

  it("waits three seconds of resting before opening", () => {
    expect(OPEN_INTENT_MS).toBe(3_000);
  });
});
