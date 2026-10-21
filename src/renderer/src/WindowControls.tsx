import { useEffect, useState } from "react";
import type { WindowControlAction } from "../../shared/contracts";
import { useCaptionControlsShown } from "./useCaptionControlsVisibility";

const glyph = (path: React.ReactNode): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

/**
 * Windows window controls in a small glass pill (TV-style rail, user decision 2026-10-20), plus
 * the invisible strip along the top that drags the window (double-click maximises). macOS keeps
 * its native traffic lights, so this renders only on Windows.
 */
export function WindowControls(): React.JSX.Element | null {
  const windows = document.documentElement.dataset.platform === "win32";
  const shown = useCaptionControlsShown();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!windows) return;
    let active = true;
    const update = (): void => {
      void window.anistream
        .getWindowState()
        .then((state) => {
          if (active) setMaximized(state.maximized);
        })
        .catch(() => undefined);
    };
    update();
    // Maximise, restore and snapping all resize the window.
    window.addEventListener("resize", update);
    return () => {
      active = false;
      window.removeEventListener("resize", update);
    };
  }, [windows]);

  if (!windows) return null;
  const act = (action: WindowControlAction) => () =>
    void window.anistream.controlWindow(action).catch(() => undefined);
  return (
    <>
      <div className="window-drag-strip" aria-hidden="true" />
      <div
        className={`window-controls${shown ? "" : " is-hidden"}`}
        role="group"
        aria-label="Window"
      >
        <button type="button" aria-label="Minimise" title="Minimise" onClick={act("minimize")}>
          {glyph(<path d="M5 12h14" />)}
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximise"}
          title={maximized ? "Restore" : "Maximise"}
          onClick={act("toggle-maximize")}
        >
          {maximized
            ? glyph(
                <>
                  <rect x="5" y="8" width="11" height="11" rx="2.5" />
                  <path d="M9 5h7.5A2.5 2.5 0 0 1 19 7.5V15" />
                </>,
              )
            : glyph(<rect x="5" y="5" width="14" height="14" rx="3" />)}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close"
          title="Close"
          onClick={act("close")}
        >
          {glyph(<path d="M6 6l12 12M18 6 6 18" />)}
        </button>
      </div>
    </>
  );
}
