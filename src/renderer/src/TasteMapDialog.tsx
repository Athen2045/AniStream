import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RecommendationSection } from "../../shared/recommendations";
import type { TasteMap, TasteMapNode, TasteTrend } from "../../shared/taste-map";
import { TasteMapCanvas } from "./taste-map-canvas";
import { useAppReducedMotion } from "./useAppReducedMotion";

const SECTION_NAME: Record<RecommendationSection, string> = {
  ANIME: "Anime",
  MANGA: "Manga",
  MORE: "Movies & TV",
};
const TREND_NAME: Record<TasteTrend, string> = {
  growing: "Growing",
  steady: "Steady",
  fading: "Fading",
};
/** Settings > Your taste map: the viewer's taste graph, Obsidian-style. */
export function TasteMapDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const [map, setMap] = useState<TasteMap>();
  const [error, setError] = useState<string>();
  const [focus, setFocus] = useState<number>();
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const closed = (): void => closeRef.current();
    element.addEventListener("close", closed);
    return () => element.removeEventListener("close", closed);
  }, []);
  useEffect(() => {
    let alive = true;
    window.anistream
      .getTasteMap()
      .then((value) => {
        if (alive) setMap(value);
      })
      .catch(() => {
        if (alive) setError("Your taste map could not be built.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const shownTitles = map?.nodes.filter((node) => node.kind === "title").length ?? 0;
  return (
    <dialog
      ref={dialog}
      className="taste-map-dialog"
      aria-labelledby="taste-map-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <header className="taste-map-head">
        <div>
          <h2 id="taste-map-title">Your taste map</h2>
          <p>
            {map
              ? map.titles
                ? `${map.titles} liked titles in ${map.clusters.length} tastes${
                    map.titles > shownTitles ? `, ${shownTitles} shown` : ""
                  }. Built on this device from your lists and watching.`
                : "Built on this device from your lists and watching."
              : (error ?? "Building your map…")}
          </p>
        </div>
        <button
          type="button"
          className="legal-dialog-close"
          aria-label="Close"
          onClick={() => dialog.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {map && map.titles ? (
        <div className="taste-map-body">
          <TasteMapGraph map={map} focus={focus} />
          <aside className="taste-map-side" aria-label="Your tastes">
            <h3>Tastes</h3>
            <ol>
              {map.clusters.map((cluster) => (
                <li key={cluster.id}>
                  <button
                    type="button"
                    className="taste-map-cluster"
                    aria-pressed={focus === cluster.id}
                    onClick={() =>
                      setFocus((current) => (current === cluster.id ? undefined : cluster.id))
                    }
                  >
                    <span
                      className={`taste-map-dot taste-map-dot--${cluster.section.toLowerCase()}`}
                    />
                    <span className="taste-map-cluster-name">{cluster.label}</span>
                    <span className="taste-map-cluster-meta">
                      {SECTION_NAME[cluster.section]} · {cluster.titles}{" "}
                      {cluster.titles === 1 ? "title" : "titles"} ·{" "}
                      <span className={`taste-map-trend taste-map-trend--${cluster.trend}`}>
                        {TREND_NAME[cluster.trend]}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="taste-map-hint">
              Scroll to zoom, drag to move. Bigger nodes weigh more in your recommendations.
            </p>
          </aside>
        </div>
      ) : map ? (
        <p className="taste-map-empty">
          Rate, finish or watch a few titles and your map starts to grow here.
        </p>
      ) : null}
    </dialog>
  );
}

function TasteMapGraph({ map, focus }: { map: TasteMap; focus?: number }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<TasteMapCanvas | null>(null);
  const reduced = useAppReducedMotion();
  const [hovered, setHovered] = useState<TasteMapNode>();
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const value = new TasteMapCanvas(element, map, setHovered, reduced);
    controller.current = value;
    return () => {
      value.dispose();
      controller.current = null;
    };
  }, [map, reduced]);
  useEffect(() => {
    controller.current?.setFocus(focus);
  }, [focus, map, reduced]);
  return (
    <div className="taste-map-canvas">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Graph of ${map.clusters.length} tastes and ${map.titles} liked titles`}
      />
      {hovered ? <NodeCard node={hovered} map={map} /> : null}
    </div>
  );
}

function NodeCard({ node, map }: { node: TasteMapNode; map: TasteMap }): React.JSX.Element {
  const cluster = map.clusters.find((row) => row.id === node.cluster);
  return (
    <div className="taste-map-card" role="status">
      {node.kind === "title" && node.coverUrl ? <img src={node.coverUrl} alt="" /> : null}
      <div>
        <strong>{node.label}</strong>
        {node.kind === "cluster" ? (
          <span>
            {SECTION_NAME[node.section]} taste · {cluster?.titles ?? 0} titles
            {node.folded ? ` (${node.folded} folded in)` : ""} ·{" "}
            {TREND_NAME[cluster?.trend ?? "steady"]}
          </span>
        ) : (
          <span>
            {SECTION_NAME[node.section]} · in {cluster?.label}
          </span>
        )}
      </div>
    </div>
  );
}
