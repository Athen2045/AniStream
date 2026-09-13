// Keep the rail predictable: native snapping plus a small action reveal is calmer than
// making every card push its neighbours around while the pointer moves quickly.
// TODO: Revisit a richer hover preview only after measuring it on low-power Windows laptops.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import { motionTiming, smoothScrollProgress } from "./motion";
import { useAppReducedMotion } from "./useAppReducedMotion";

export function ContentCarousel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useAppReducedMotion();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const itemCount = Children.count(children);
  const boundaryFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const boundaryStateRef = useRef({ left: false, right: false });

  useLayoutEffect(() => {
    setNavigationHost(
      viewportRef.current?.closest("section")?.querySelector<HTMLElement>(".rail-heading") ?? null,
    );
  }, []);

  const updateBoundaries = useCallback((): void => {
    if (boundaryFrameRef.current !== null) return;
    boundaryFrameRef.current = window.requestAnimationFrame(() => {
      boundaryFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;

      const nextBoundaries = {
        left: viewport.scrollLeft > 4,
        right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 4,
      };
      if (
        nextBoundaries.left === boundaryStateRef.current.left &&
        nextBoundaries.right === boundaryStateRef.current.right
      ) {
        return;
      }

      boundaryStateRef.current = nextBoundaries;
      setCanScrollLeft(nextBoundaries.left);
      setCanScrollRight(nextBoundaries.right);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (boundaryFrameRef.current !== null) {
        window.cancelAnimationFrame(boundaryFrameRef.current);
        boundaryFrameRef.current = null;
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  const stopProgrammaticScroll = useCallback((): void => {
    if (scrollFrameRef.current === null) return;
    window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateBoundaries();
    const resizeObserver = new ResizeObserver(updateBoundaries);
    resizeObserver.observe(viewport);
    if (trackRef.current) resizeObserver.observe(trackRef.current);
    return () => resizeObserver.disconnect();
  }, [itemCount, updateBoundaries]);

  // Tabbing through cards can otherwise leave the newly focused card hidden behind
  // the edge-fade gradients; keep it scrolled into view as focus moves.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scrollFocusedCardIntoView = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement && event.target !== viewport) {
        event.target.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: reducedMotion ? "auto" : "smooth",
        });
      }
    };
    viewport.addEventListener("focusin", scrollFocusedCardIntoView);
    return () => viewport.removeEventListener("focusin", scrollFocusedCardIntoView);
  }, [reducedMotion]);

  const scrollByPage = useCallback(
    (direction: -1 | 1): void => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      stopProgrammaticScroll();

      const start = viewport.scrollLeft;
      const distance = Math.max(240, Math.round(viewport.clientWidth * 0.74));
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const target = Math.min(maximum, Math.max(0, start + direction * distance));
      if (target === start) return;

      if (reducedMotion) {
        viewport.scrollLeft = target;
        updateBoundaries();
        return;
      }

      const startedAt = window.performance.now();
      const duration = motionTiming.glide * 1_000;
      const animateScroll = (timestamp: number): void => {
        const progress = smoothScrollProgress((timestamp - startedAt) / duration);
        viewport.scrollLeft = start + (target - start) * progress;
        if (progress < 1) {
          scrollFrameRef.current = window.requestAnimationFrame(animateScroll);
          return;
        }
        scrollFrameRef.current = null;
        updateBoundaries();
      };

      scrollFrameRef.current = window.requestAnimationFrame(animateScroll);
    },
    [reducedMotion, stopProgrammaticScroll, updateBoundaries],
  );

  const navigation = (
    <div className="carousel-navigation" aria-label={`${label} navigation`}>
      <button
        className="carousel-edge carousel-edge-left"
        type="button"
        aria-label={`Show previous ${label}`}
        title="Previous titles"
        disabled={!canScrollLeft}
        onClick={() => scrollByPage(-1)}
      >
        <span>
          <ChevronLeft size={27} strokeWidth={2.4} />
        </span>
      </button>
      <button
        className="carousel-edge carousel-edge-right"
        type="button"
        aria-label={`Show more ${label}`}
        title="More titles"
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        <span>
          <ChevronRight size={27} strokeWidth={2.4} />
        </span>
      </button>
    </div>
  );

  return (
    <div className="content-carousel">
      {navigationHost ? createPortal(navigation, navigationHost) : navigation}
      <div
        className="carousel-viewport"
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label={label}
        onScroll={updateBoundaries}
        onPointerDown={stopProgrammaticScroll}
        onWheel={stopProgrammaticScroll}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            scrollByPage(-1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            scrollByPage(1);
          }
        }}
      >
        <div className="carousel-track" ref={trackRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
