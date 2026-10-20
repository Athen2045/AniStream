import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import appIcon from "./assets/app-icon.png";
import { navIndicatorTransition } from "./motion";

/**
 * The pointer must rest on the rail this long before it opens (user decision 2026-10-20): moving
 * through it, or clicking from one section to another, never opens it.
 */
export const OPEN_INTENT_MS = 3_000;
/** Grace after the pointer leaves, so brushing the edge does not flicker it shut. */
const CLOSE_GRACE_MS = 150;

export interface SideRailItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** Small count on the icon (Up Next queue, downloads in progress). */
  badge?: number;
  /** Accessible name when it says more than the label (e.g. "Downloads, 2 in progress"). */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  /** A picture instead of the icon (the profile's avatar). */
  imageUrl?: string;
  /** Spins the icon once (library refresh). */
  iconClassName?: string;
  onIconAnimationEnd?: () => void;
  onSelect: () => void;
}

/**
 * TV-style left rail (user decision 2026-10-20; mockups prototypes/mockups/tv-ui/): 64 px of icons
 * at rest, opening to 264 px with labels only when the pointer rests on it for 3 s or keyboard focus
 * enters it. It opens over the page (no reflow): one edge moves (clip-path) while the labels fade
 * in place, after the user's reference video.
 */
export function SideRail({
  sections,
  tools,
  footer,
  reducedMotion,
  onHome,
}: {
  sections: SideRailItem[];
  tools: SideRailItem[];
  /** Bottom rows: library refresh, Report a bug, profile, Settings. */
  footer: SideRailItem[];
  reducedMotion: boolean;
  onHome: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const closeToPage = (): void => {
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
    document
      .querySelector<HTMLElement>(
        "main.app-shell [data-rail-return], main.app-shell h1, main.app-shell button",
      )
      ?.focus({ preventScroll: true });
  };

  const row = (item: SideRailItem): React.JSX.Element => {
    const Icon = item.icon;
    return (
      <button
        key={item.key}
        type="button"
        className={`side-rail-item${item.active ? " is-active" : ""}`}
        aria-label={item.ariaLabel ?? item.label}
        aria-current={item.active ? "page" : undefined}
        title={open ? undefined : (item.title ?? item.label)}
        disabled={item.disabled}
        onClick={() => {
          // Going from one section to another is not a reason to open it.
          window.clearTimeout(timer.current);
          item.onSelect();
          setOpen(false);
        }}
      >
        {item.active ? (
          <motion.span
            className="side-rail-indicator"
            layoutId="side-rail-indicator"
            transition={navIndicatorTransition(reducedMotion)}
            aria-hidden="true"
          />
        ) : null}
        <span className="side-rail-icon">
          {item.imageUrl ? (
            <img className="side-rail-avatar" src={item.imageUrl} alt="" decoding="async" />
          ) : (
            <Icon
              size={20}
              strokeWidth={1.9}
              aria-hidden="true"
              className={item.iconClassName}
              onAnimationEnd={item.onIconAnimationEnd}
            />
          )}
          {item.badge ? (
            <span className="side-rail-badge">{item.badge > 99 ? "99+" : item.badge}</span>
          ) : null}
        </span>
        <span className="side-rail-label">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <nav
        ref={rail}
        className={`side-rail${open ? " is-open" : ""}`}
        aria-label="Main navigation"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") schedule(true, OPEN_INTENT_MS);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") schedule(false, CLOSE_GRACE_MS);
        }}
        onFocus={(event) => {
          // Keyboard focus opens it; a mouse click focuses too, but the pointer already decided.
          if (event.target.matches(":focus-visible")) schedule(true, 0);
        }}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node && rail.current?.contains(event.relatedTarget)))
            schedule(false, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "ArrowRight") {
            event.preventDefault();
            closeToPage();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const stops = [
            ...(rail.current?.querySelectorAll<HTMLButtonElement>(
              ".side-rail-logo, .side-rail-item:not(:disabled)",
            ) ?? []),
          ];
          const at = stops.indexOf(document.activeElement as HTMLButtonElement);
          if (at === -1) return;
          event.preventDefault();
          stops[(at + (event.key === "ArrowDown" ? 1 : -1) + stops.length) % stops.length]?.focus();
        }}
      >
        <button
          type="button"
          className="side-rail-logo"
          aria-label="AniStream home"
          title={open ? undefined : "AniStream home"}
          onClick={() => {
            window.clearTimeout(timer.current);
            onHome();
            setOpen(false);
          }}
        >
          <img src={appIcon} alt="" aria-hidden="true" />
          <span className="side-rail-label">AniStream</span>
        </button>
        <div className="side-rail-group">{sections.map(row)}</div>
        {tools.length ? (
          <>
            <span className="side-rail-sep" aria-hidden="true" />
            <div className="side-rail-group">{tools.map(row)}</div>
          </>
        ) : null}
        <span className="side-rail-grow" aria-hidden="true" />
        <div className="side-rail-group">{footer.map(row)}</div>
      </nav>
    </>
  );
}
