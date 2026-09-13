import { useCallback, useEffect, useRef } from "react";

import { shouldSmoothWheel, smoothFollowStep, wheelDeltaPixels } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";

function hasNestedVerticalScroller(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== document.body && element !== document.documentElement) {
    const style = window.getComputedStyle(element);
    if (
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1
    ) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

export function useSmoothDocumentScroll(): () => void {
  const reducedMotion = useAppReducedMotion();
  const frameRef = useRef<number | null>(null);
  const targetRef = useRef(0);
  const previousTimeRef = useRef(0);

  const cancel = useCallback((): void => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const root = document.scrollingElement;
    targetRef.current = root?.scrollTop ?? window.scrollY;
  }, []);

  useEffect(() => {
    const isWindows = document.documentElement.dataset.platform === "win32";
    if (!isWindows || reducedMotion) return;

    const animate = (timestamp: number): void => {
      const root = document.scrollingElement;
      if (!root) {
        frameRef.current = null;
        return;
      }

      const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
      targetRef.current = Math.min(maximum, Math.max(0, targetRef.current));
      const elapsed = previousTimeRef.current ? timestamp - previousTimeRef.current : 16;
      previousTimeRef.current = timestamp;
      const next = smoothFollowStep(root.scrollTop, targetRef.current, elapsed);
      root.scrollTop = Math.abs(targetRef.current - next) < 0.5 ? targetRef.current : next;

      if (root.scrollTop === targetRef.current) {
        frameRef.current = null;
        previousTimeRef.current = 0;
        return;
      }
      frameRef.current = window.requestAnimationFrame(animate);
    };

    const onWheel = (event: WheelEvent): void => {
      if (
        event.defaultPrevented ||
        !shouldSmoothWheel(event.deltaY, event.deltaMode, event.ctrlKey, event.shiftKey) ||
        hasNestedVerticalScroller(event.target)
      ) {
        cancel();
        return;
      }

      const root = document.scrollingElement;
      if (!root) return;
      const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
      if (maximum === 0) return;

      event.preventDefault();
      if (frameRef.current === null) targetRef.current = root.scrollTop;
      const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, root.clientHeight);
      const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), root.clientHeight * 0.85);
      targetRef.current = Math.min(maximum, Math.max(0, targetRef.current + boundedDelta));

      if (frameRef.current === null) {
        previousTimeRef.current = 0;
        frameRef.current = window.requestAnimationFrame(animate);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
      cancel();
    };
  }, [cancel, reducedMotion]);

  return cancel;
}
