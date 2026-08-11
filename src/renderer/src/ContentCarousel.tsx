// Keep the rail predictable: native snapping plus a small action reveal is calmer than
// making every card push its neighbours around while the pointer moves quickly.
// TODO: Revisit a richer hover preview only after measuring it on low-power Windows laptops.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { Children, useCallback, useEffect, useRef, useState } from "react";

export function ContentCarousel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const itemCount = Children.count(children);

  const updateBoundaries = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCanScrollLeft(viewport.scrollLeft > 4);
    setCanScrollRight(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 4);
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
      viewport.scrollBy({
        left: direction * Math.max(240, viewport.clientWidth - 32),
        behavior: reducedMotion ? "auto" : "smooth",
      });
    },
    [reducedMotion],
  );

  return (
    <div className="content-carousel">
      <button
        className="carousel-edge carousel-edge-left"
        type="button"
        aria-label={`Show previous ${label}`}
        disabled={!canScrollLeft}
        onClick={() => scrollByPage(-1)}
      >
        <span>
          <ChevronLeft size={27} strokeWidth={2.4} />
        </span>
      </button>
      <div
        className="carousel-viewport"
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label={label}
        onScroll={updateBoundaries}
        onKeyDown={(event) => {
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
      <button
        className="carousel-edge carousel-edge-right"
        type="button"
        aria-label={`Show more ${label}`}
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
      >
        <span>
          <ChevronRight size={27} strokeWidth={2.4} />
        </span>
      </button>
    </div>
  );
}
