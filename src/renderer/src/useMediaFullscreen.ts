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
      // Player frames normally forward their fullscreen calls (below); this covers a frame the
      // bridge does not reach. By the time Chromium reports a frame's own fullscreen (seconds later)
      // the click may no longer count as a gesture, and taking fullscreen away from the frame would
      // drop the viewer back to a window, so the frame then keeps it.
      if (element instanceof HTMLIFrameElement && root?.contains(element) && !leaving.current) {
        if (before === root) void leaveAll();
        else if (navigator.userActivation?.isActive !== false) void adoptFrom(element, root);
        else setFullscreen(true);
        return;
      }
      const active = Boolean(element && root?.contains(element));
      if (!element) exitedAt.current = Date.now();
      setFullscreen(active);
      // Player frames with the bridge mirror this, so their own button shows the right state.
      root
        ?.querySelectorAll("iframe")
        .forEach((frame) =>
          frame.contentWindow?.postMessage({ anistreamFullscreenState: active }, "*"),
        );
    };
    // The main process gives player frames a bridge (`frameFullscreenBridgeScript`): their
    // fullscreen button posts here instead, and the whole player view goes fullscreen at once, while
    // the click in the frame still counts as the viewer's gesture; its exit call leaves.
    const forwarded = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      const action = (data as { anistreamFullscreen?: unknown }).anistreamFullscreen;
      if (action !== "request" && action !== "exit") return;
      const root = target.current;
      // Only a frame AniStream itself shows inside this player may ask.
      const fromPlayer =
        root &&
        [...root.querySelectorAll("iframe")].some((frame) => frame.contentWindow === event.source);
      if (!fromPlayer) return;
      // The frame is told the state (below), so a request while fullscreen is a repeat: only an
      // exit leaves.
      if (action === "exit") {
        if (document.fullscreenElement) void leaveAll();
      } else if (!document.fullscreenElement) void root.requestFullscreen().catch(() => undefined);
    };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("message", forwarded);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("message", forwarded);
    };
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
