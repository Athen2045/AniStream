import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Fullscreen changes presentation only; it never dismisses an episode or chapter. */
export function useMediaFullscreen(target: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string>();
  const exitedAt = useRef(0);
  useEffect(() => {
    const changed = () => {
      const element = document.fullscreenElement;
      const active = Boolean(element && target.current?.contains(element));
      if (!element) exitedAt.current = Date.now();
      setFullscreen(active);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [target]);
  const exitFullscreen = useCallback(async () => {
    const element = document.fullscreenElement;
    if (element && target.current?.contains(element)) await document.exitFullscreen();
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
