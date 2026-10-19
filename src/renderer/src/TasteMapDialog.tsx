import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Minus,
  Plus,
  Scan,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RecommendationSection } from "../../shared/recommendations";
import type { TasteMap, TasteMapCluster, TasteTrend } from "../../shared/taste-map";
import { TasteMapCanvas, type TasteMapHover, type TasteMapInsets } from "./taste-map-canvas";
import { useAppReducedMotion } from "./useAppReducedMotion";

const SECTION_NAME: Record<RecommendationSection, string> = {
  ANIME: "Anime",
  MANGA: "Manga",
  MORE: "Movies & TV",
};
const SECTION_NOUN: Record<RecommendationSection, string> = {
  ANIME: "anime",
  MANGA: "manga",
  MORE: "movie & TV",
};
const SECTIONS: RecommendationSection[] = ["ANIME", "MANGA", "MORE"];
const TREND_NAME: Record<TasteTrend, string> = {
  growing: "Growing",
  steady: "Steady",
  fading: "Fading",
};
/** Room the floating controls take; the map frames itself inside the rest. */
const INSETS: TasteMapInsets = { top: 84, right: 28, bottom: 100, left: 28 };
/** The picked taste's panel (352px wide, 28px from the edge) plus a gap. */
const PANEL_INSET = 400;
/** Below this width the filter sits under the title (see taste-map.css). */
const NARROW_QUERY = "(max-width: 1000px)";
const NARROW_TOP_INSET = 130;
const STRONGEST = 6;
const POPOVER_WIDTH = 300;

/**
 * Settings > Your Taste Graph: the viewer's taste graph over the whole window, with floating
 * controls (section filter, the tastes along the bottom, zoom) instead of a framed sidebar.
 * Mockups: `prototypes/mockups/taste-map-redesign/` (approved 2026-10-11).
 */
export function TasteMapDialog({
  onClose,
  loadMap = () => window.anistream.getTasteMap(),
}: {
  onClose: () => void;
  /** Where the map comes from; tests and previews pass their own. */
  loadMap?: () => Promise<TasteMap>;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const [map, setMap] = useState<TasteMap>();
  const [error, setError] = useState<string>();
  const [focus, setFocus] = useState<number>();
  const [section, setSection] = useState<RecommendationSection>();
  const focusRef = useRef(focus);
  const loadRef = useRef(loadMap);
  useEffect(() => {
    closeRef.current = onClose;
    focusRef.current = focus;
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    // Start on the dialog itself, not with a focus ring on Close; Tab reaches the controls.
    element.focus();
    const closed = (): void => closeRef.current();
    // Escape first lets go of a picked taste, then closes.
    const cancel = (event: Event): void => {
      if (focusRef.current === undefined) return;
      event.preventDefault();
      setFocus(undefined);
    };
    element.addEventListener("close", closed);
    element.addEventListener("cancel", cancel);
    return () => {
      element.removeEventListener("close", closed);
      element.removeEventListener("cancel", cancel);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    loadRef
      .current()
      .then((value) => {
        if (alive) setMap(value);
      })
      .catch(() => {
        if (alive) setError("Your Taste Graph could not be built.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const ready = Boolean(map?.titles);
  const picked = map?.clusters.find((cluster) => cluster.id === focus);
  return (
    <dialog
      ref={dialog}
      className="taste-map-dialog"
      aria-labelledby="taste-map-title"
      tabIndex={-1}
    >
      {map && ready ? (
        <TasteMapGraph
          map={map}
          focus={focus}
          section={section}
          onPick={(cluster) => setFocus((current) => (current === cluster ? undefined : cluster))}
        />
      ) : (
        <TasteMapPlaceholder state={error ? "error" : map ? "empty" : "building"} error={error} />
      )}

      <header className="taste-map-top">
        <div className="taste-map-heading">
          <h2 id="taste-map-title">Your Taste Graph</h2>
          <p>{summary(map, section, error)}</p>
        </div>
      </header>

      {/* The filter, then Close as its last segment, clear of the window's own buttons. */}
      <div className="taste-map-filter">
        {map && ready ? (
          <div className="taste-map-filter-group" role="group" aria-label="Show tastes from">
            <button
              type="button"
              aria-pressed={section === undefined}
              onClick={() => setSection(undefined)}
            >
              All
            </button>
            {SECTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={section === value}
                onClick={() => {
                  setSection((current) => (current === value ? undefined : value));
                  if (picked && picked.section !== value) setFocus(undefined);
                }}
              >
                <span className={`taste-map-dot taste-map-dot--${value.toLowerCase()}`} />
                {SECTION_NAME[value]}
              </button>
            ))}
          </div>
        ) : null}
        {map && ready ? <span className="taste-map-filter-divider" aria-hidden="true" /> : null}
        <button
          type="button"
          className="taste-map-filter-close"
          aria-label="Close"
          title="Close"
          onClick={() => dialog.current?.close()}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {map && picked ? (
        <TastePanel map={map} cluster={picked} onClose={() => setFocus(undefined)} />
      ) : null}
    </dialog>
  );
}

function summary(
  map: TasteMap | undefined,
  section: RecommendationSection | undefined,
  error: string | undefined,
): React.ReactNode {
  if (error) return error;
  if (!map) return "Building…";
  if (!map.titles) return "Built on this device from your lists and watching";
  if (!section)
    return (
      <>
        <b>{map.titles}</b> liked titles · <b>{map.clusters.length}</b> tastes · built on this
        device
      </>
    );
  const tastes = map.clusters.filter((cluster) => cluster.section === section);
  if (!tastes.length) return `No ${SECTION_NOUN[section]} tastes yet`;
  const titles = tastes.reduce((sum, cluster) => sum + cluster.titles, 0);
  return (
    <>
      <b>{titles}</b> {SECTION_NOUN[section]} titles · <b>{tastes.length}</b>{" "}
      {tastes.length === 1 ? "taste" : "tastes"}
    </>
  );
}

function TasteMapGraph({
  map,
  focus,
  section,
  onPick,
}: {
  map: TasteMap;
  focus?: number;
  section?: RecommendationSection;
  onPick: (cluster: number) => void;
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<TasteMapCanvas | null>(null);
  const pickRef = useRef(onPick);
  const reduced = useAppReducedMotion();
  const [hovered, setHovered] = useState<TasteMapHover>();
  const narrow = useNarrowWindow();
  useEffect(() => {
    pickRef.current = onPick;
  });
  // A layout effect, like the one below, so the insets and pick apply to this controller.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const value = new TasteMapCanvas(element, map, setHovered, reduced, (cluster) =>
      pickRef.current(cluster),
    );
    controller.current = value;
    return () => {
      value.dispose();
      controller.current = null;
    };
  }, [map, reduced]);
  // Insets first, so a newly picked taste is framed beside its panel.
  useLayoutEffect(() => {
    controller.current?.setInsets({
      ...INSETS,
      top: narrow ? NARROW_TOP_INSET : INSETS.top,
      right: focus === undefined ? INSETS.right : PANEL_INSET,
    });
    controller.current?.setFocus(focus);
  }, [focus, map, reduced, narrow]);
  useEffect(() => {
    controller.current?.setSection(section);
  }, [section, map, reduced]);
  return (
    <div className="taste-map-canvas">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Graph of ${map.clusters.length} tastes and ${map.titles} liked titles`}
      />
      {hovered ? (
        <NodePopover
          hover={hovered}
          map={map}
          rightInset={focus === undefined ? INSETS.right : PANEL_INSET}
        />
      ) : null}
      <TasteDock
        map={map}
        focus={focus}
        section={section}
        onPick={onPick}
        onZoom={(factor) => controller.current?.zoomBy(factor)}
        onFit={() => controller.current?.fitAll()}
      />
    </div>
  );
}

function TasteDock({
  map,
  focus,
  section,
  onPick,
  onZoom,
  onFit,
}: {
  map: TasteMap;
  focus?: number;
  section?: RecommendationSection;
  onPick: (cluster: number) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const tastes = useMemo(
    () => [...map.clusters].sort((a, b) => b.titles - a.titles),
    [map.clusters],
  );
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const update = (): void =>
      setMore(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [tastes]);
  return (
    <div className="taste-map-dock">
      <div className={`taste-map-chips${more ? " has-more" : ""}`}>
        <div className="taste-map-chip-strip" ref={strip} role="group" aria-label="Your tastes">
          {tastes.map((cluster) => (
            <button
              key={cluster.id}
              type="button"
              className={`taste-map-chip${section && cluster.section !== section ? " is-faded" : ""}`}
              aria-pressed={focus === cluster.id}
              title={`${cluster.label} · ${SECTION_NAME[cluster.section]} · ${cluster.titles} titles · ${TREND_NAME[cluster.trend]}`}
              onClick={() => onPick(cluster.id)}
            >
              <span className={`taste-map-dot taste-map-dot--${cluster.section.toLowerCase()}`} />
              {cluster.label}
              <small>{cluster.titles}</small>
              <TrendIcon trend={cluster.trend} />
            </button>
          ))}
        </div>
        {more ? (
          <button
            type="button"
            className="taste-map-chip-more"
            aria-label="More tastes"
            onClick={() =>
              strip.current?.scrollBy({
                left: strip.current.clientWidth * 0.6,
                behavior: "smooth",
              })
            }
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="taste-map-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => onZoom(1 / 1.35)}
        >
          <Minus size={18} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(1.35)}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit the map" title="Fit the map" onClick={onFit}>
          <Scan size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function TrendIcon({ trend }: { trend: TasteTrend }): React.JSX.Element {
  const Icon =
    trend === "growing" ? ArrowUpRight : trend === "fading" ? ArrowDownRight : ArrowRight;
  return (
    <span className={`taste-map-trend taste-map-trend--${trend}`} title={TREND_NAME[trend]}>
      <Icon size={14} strokeWidth={2.4} aria-label={TREND_NAME[trend]} />
    </span>
  );
}

/** The picked taste: what it is and the titles that weigh most in it. */
function TastePanel({
  map,
  cluster,
  onClose,
}: {
  map: TasteMap;
  cluster: TasteMapCluster;
  onClose: () => void;
}): React.JSX.Element {
  const titles = map.nodes
    .filter((node) => node.kind === "title" && node.cluster === cluster.id)
    .sort((a, b) => b.weight - a.weight);
  const strongest = titles.slice(0, STRONGEST);
  const top = strongest[0]?.weight || 1;
  const rest = cluster.titles - strongest.length;
  return (
    <aside className="taste-map-panel" aria-label={`${cluster.label} taste`}>
      <button
        type="button"
        className="taste-map-panel-close"
        aria-label="Back to the whole map"
        onClick={onClose}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <span className="taste-map-kicker">
        <span className={`taste-map-dot taste-map-dot--${cluster.section.toLowerCase()}`} />
        {SECTION_NAME[cluster.section]} taste
      </span>
      <h3>{cluster.label}</h3>
      <p className="taste-map-panel-meta">
        {cluster.titles} {cluster.titles === 1 ? "title" : "titles"} ·{" "}
        <TrendIcon trend={cluster.trend} />
        {TREND_NAME[cluster.trend]}
      </p>
      {strongest.length ? (
        <>
          <h4>Strongest in your picks</h4>
          <ol className="taste-map-strongest">
            {strongest.map((node) => (
              <li key={node.id}>
                {node.coverUrl ? (
                  <img src={node.coverUrl} alt="" />
                ) : (
                  <span className="taste-map-nocover" />
                )}
                <div>
                  <strong>{node.label}</strong>
                  <span
                    className="taste-map-weight"
                    role="meter"
                    aria-label="Weight in your recommendations"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((node.weight / top) * 100)}
                  >
                    <i
                      className={`taste-map-weight-fill taste-map-weight-fill--${node.section.toLowerCase()}`}
                      style={{ width: `${Math.round((node.weight / top) * 100)}%` }}
                    />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {rest > 0 ? (
        <p className="taste-map-panel-foot">
          {rest} more {rest === 1 ? "title" : "titles"} in this taste
        </p>
      ) : null}
    </aside>
  );
}

/** Beside the hovered node: what it is, and for a title, what it links to. */
function NodePopover({
  hover,
  map,
  rightInset,
}: {
  hover: TasteMapHover;
  map: TasteMap;
  rightInset: number;
}): React.JSX.Element {
  const { node } = hover;
  const cluster = map.clusters.find((row) => row.id === node.cluster);
  const { width, height } = hover;
  const gap = hover.radius + 14;
  const right = hover.x + gap + POPOVER_WIDTH <= width - rightInset;
  const left = right ? hover.x + gap : Math.max(INSETS.left, hover.x - gap - POPOVER_WIDTH);
  const top = clamp(hover.y - 60, INSETS.top, height - INSETS.bottom - 190);
  const linked =
    node.kind === "title"
      ? map.links
          .filter((link) => link.source === node.id || link.target === node.id)
          .map((link) => (link.source === node.id ? link.target : link.source))
          .flatMap((id) => {
            const other = map.nodes.find((candidate) => candidate.id === id);
            return other?.kind === "title" ? [other.label] : [];
          })
      : [];
  return (
    <div className="taste-map-popover" role="status" style={{ left, top, width: POPOVER_WIDTH }}>
      <div className="taste-map-popover-head">
        {node.kind === "title" && node.coverUrl ? <img src={node.coverUrl} alt="" /> : null}
        <div>
          <strong>{node.label}</strong>
          <span className="taste-map-popover-sub">
            <span className={`taste-map-dot taste-map-dot--${node.section.toLowerCase()}`} />
            {node.kind === "cluster"
              ? `${SECTION_NAME[node.section]} taste · ${cluster?.titles ?? 0} titles · ${TREND_NAME[cluster?.trend ?? "steady"]}`
              : `${SECTION_NAME[node.section]} · ${cluster?.label ?? ""}`}
          </span>
        </div>
      </div>
      {node.kind === "cluster" && node.folded ? (
        <p className="taste-map-popover-links">
          {node.folded} smaller {node.folded === 1 ? "title is" : "titles are"} folded into this
          point. Click it to see the taste.
        </p>
      ) : node.kind === "cluster" ? (
        <p className="taste-map-popover-links">Click it to see the taste.</p>
      ) : linked.length ? (
        <p className="taste-map-popover-links">
          Linked to{" "}
          {linked.slice(0, 3).map((label, at) => (
            <span key={label}>
              {at ? ", " : ""}
              <b>{label}</b>
            </span>
          ))}
          {linked.length > 3 ? ` and ${linked.length - 3} more` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** While the map is built, or when there is nothing to map yet. */
function TasteMapPlaceholder({
  state,
  error,
}: {
  state: "building" | "empty" | "error";
  error?: string;
}): React.JSX.Element {
  const points: Array<[radius: number, angle: number, section: string, size: number]> = [
    [150, -0.6, "anime", 6],
    [150, 2.2, "more", 4],
    [96, 1.1, "manga", 6],
    [96, 3.9, "anime", 4],
    [46, 5.2, "more", 6],
    [150, 4.1, "anime", 4],
  ];
  return (
    <div className="taste-map-placeholder" role="status">
      <svg viewBox="-170 -170 340 340" width="340" height="340" aria-hidden="true">
        {[150, 96, 46].map((radius) => (
          <circle key={radius} r={radius} className="taste-map-orbit" />
        ))}
        {points.map(([radius, angle, kind, size]) => {
          const x = radius * Math.cos(angle);
          const y = radius * Math.sin(angle);
          return (
            <g key={`${radius}-${angle}`}>
              <line x2={x} y2={y} className="taste-map-orbit-line" />
              <circle
                cx={x}
                cy={y}
                r={size}
                className={`taste-map-orbit-point taste-map-orbit-point--${kind}`}
              />
            </g>
          );
        })}
        <circle r="14" className="taste-map-orbit-hub" />
        <circle r="3.5" className="taste-map-orbit-core" />
      </svg>
      {state === "building" ? (
        <>
          <h3>Mapping your taste…</h3>
          <p>Linking the titles you liked. This stays on this device.</p>
          <span className="sk-line taste-map-progress" />
        </>
      ) : state === "error" ? (
        <>
          <h3>The map could not be built</h3>
          <p>{error} Close it and try again in a moment.</p>
        </>
      ) : (
        <>
          <h3>Your graph starts here</h3>
          <p>
            Rate, finish or watch a few titles. Each one becomes a point here, and titles you like
            for the same reasons pull together.
          </p>
        </>
      )}
    </div>
  );
}

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = (): void => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
