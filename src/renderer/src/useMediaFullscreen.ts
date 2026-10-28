import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Fullscreen changes presentation only; it never dismisses an episode or chapter. */
export function useMediaFullscreen(target: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string>();
  const exitedAt = useRef(0);
  // Set while the app leaves fullscreen, so the frame showing through is not taken over again.
  const leaving = useRef(false);
  const previous = useRef<Element | null>(null);
  useEffect(() => {
    const leaveAll = async (): Promise<void> => {
      leaving.current = true;
      try {
        for (let level = 0; level < 3 && document.fullscreenElement; level += 1)
          await document.exitFullscreen();
      } catch {
        // Already left.
      } finally {
        leaving.current = false;
      }
    };
    const changed = () => {
      const element = document.fullscreenElement;
      const root = target.current;
      const before = previous.current;
      previous.current = element;
      // An embedded player's own fullscreen button makes its frame the fullscreen element, and
      // nothing outside the frame (the autoplay prompt, notices) can show over it. Fullscreen moves
      // to the whole player instead (`adoptFrom`). Pressed again while the player is fullscreen,
      // that button means "leave fullscreen", so it does.
      if (element instanceof HTMLIFrameElement && root?.contains(element) && !leaving.current) {
        if (before === root) void leaveAll();
        else void adoptFrom(element, root);
        return;
      }
      const active = Boolean(element && root?.contains(element));
      if (!element) exitedAt.current = Date.now();
      setFullscreen(active);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [target]);
  const exitFullscreen = useCallback(async () => {
    // After a take-over the player frame is fullscreen under the player: leave both.
    leaving.current = true;
    try {
      for (let level = 0; level < 3; level += 1) {
        const element = document.fullscreenElement;
        if (!element || !target.current?.contains(element)) break;
        await document.exitFullscreen();
      }
    } finally {
      leaving.current = false;
    }
  }, [target]);
  const toggleFullscreen = useCallback(async () => {
    setFullscreenError(undefined);
    try {
      if (document.fullscreenElement) await exitFullscreen();
      else await target.current?.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen could not be changed. Please try again.");
    }
  }, [exitFullscreen, target]);
  // Chromium can dispatch Escape after it has already removed the fullscreen element.
  const isFullscreenEscape = useCallback(
    () => Boolean(document.fullscreenElement) || Date.now() - exitedAt.current < 400,
    [],
  );
  return { fullscreen, fullscreenError, toggleFullscreen, exitFullscreen, isFullscreenEscape };
}

/**
 * Moves fullscreen from a player frame to `root`. The frame leaves fullscreen first: left in the
 * top layer under `root`, it was covered by the player's black background and backdrop (a black
 * screen with the sound playing, user report 2026-10-28). Chromium refuses while the window is
 * still changing fullscreen, so entering retries for about five seconds; the click in the frame
 * still counts as the viewer's gesture.
 */
async function adoptFrom(frame: HTMLIFrameElement, root: HTMLElement): Promise<void> {
  for (const wait of [0, 150, 250, 400, 600, 800, 1000, 1000, 1000]) {
    if (wait) await new Promise((done) => window.setTimeout(done, wait));
    if (document.fullscreenElement === frame)
      await document.exitFullscreen().catch(() => undefined);
    if (document.fullscreenElement === root) return;
    // Something else took fullscreen meanwhile (or the viewer left it): leave that alone.
    if (document.fullscreenElement) return;
    try {
      await root.requestFullscreen();
      return;
    } catch {
      // Still entering fullscreen; try again shortly.
    }
  }
}
