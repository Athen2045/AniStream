import type { TasteMap, TasteMapLink, TasteMapNode } from "../../shared/taste-map";
import { ForceLayout } from "./taste-map-layout";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Title labels fade in from this zoom, as in Obsidian's graph view. */
const LABEL_ZOOM = 1.15;
/** Ticks run before the first frame, so the map opens nearly settled. */
const WARM_TICKS = 140;
interface Camera {
  x: number;
  y: number;
  k: number;
}

interface Pointer {
  mode: "node" | "pan";
  node?: number;
  x: number;
  y: number;
}

/**
 * Draws the taste map on a canvas and runs its interaction: drag a node (it stays pinned while
 * held), drag the background to pan, scroll to zoom about the cursor, hover to light a node and
 * its neighbours. Imperative on purpose: it redraws every animation frame while the layout moves.
 */
export class TasteMapCanvas {
  private readonly layout: ForceLayout;
  private readonly neighbors: Array<Set<number>>;
  private readonly links: Array<{
    source: number;
    target: number;
    weight: number;
    kind: TasteMapLink["kind"];
  }>;
  private camera: Camera = { x: 0, y: 0, k: 1 };
  /** The camera frames the whole map while it settles, until the viewer pans, zooms or drags. */
  private autoFit = true;
  private pointer?: Pointer;
  private hover?: number;
  private focus?: number;
  private dirty = true;
  private frame = 0;
  private readonly observer: ResizeObserver;
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: TasteMap,
    private readonly onHover: (node: TasteMapNode | undefined) => void,
    reducedMotion: boolean,
  ) {
    this.layout = new ForceLayout(map);
    this.layout.tick(reducedMotion ? 400 : WARM_TICKS);
    const index = new Map(map.nodes.map((node, at) => [node.id, at]));
    this.neighbors = map.nodes.map(() => new Set<number>());
    this.links = map.links.flatMap((link) => {
      const source = index.get(link.source);
      const target = index.get(link.target);
      if (source === undefined || target === undefined) return [];
      this.neighbors[source].add(target);
      this.neighbors[target].add(source);
      return [{ source, target, weight: link.weight, kind: link.kind }];
    });
    this.observer = new ResizeObserver(() => {
      this.dirty = true;
    });
    this.observer.observe(canvas);
    this.detach = this.listen();
    this.frame = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.detach();
  }

  /** Lights one taste and centres the camera on its hub; undefined clears it. */
  setFocus(cluster: number | undefined): void {
    this.focus = cluster;
    this.dirty = true;
    if (cluster === undefined) return;
    this.autoFit = false;
    const hub = this.map.nodes.findIndex(
      (node) => node.kind === "cluster" && node.cluster === cluster,
    );
    if (hub < 0) return;
    const { x, y } = this.layout.nodes[hub];
    const k = Math.max(1.2, this.camera.k);
    this.camera = { x: -x * k, y: -y * k, k };
  }

  private readonly loop = (): void => {
    if (!this.layout.settled) {
      this.layout.tick();
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private listen(): () => void {
    const canvas = this.canvas;
    const down = (event: PointerEvent): void => {
      this.autoFit = false;
      const node = this.hit(event);
      canvas.setPointerCapture(event.pointerId);
      this.pointer = {
        mode: node === undefined ? "pan" : "node",
        node,
        x: event.clientX,
        y: event.clientY,
      };
      if (node !== undefined) {
        const point = this.toWorld(event);
        this.layout.pin(node, point.x, point.y);
        this.layout.reheat(0.3);
      }
    };
    const move = (event: PointerEvent): void => {
      const drag = this.pointer;
      if (drag?.mode === "pan") {
        this.camera.x += event.clientX - drag.x;
        this.camera.y += event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        this.dirty = true;
        return;
      }
      if (drag?.mode === "node" && drag.node !== undefined) {
        const point = this.toWorld(event);
        this.layout.pin(drag.node, point.x, point.y);
        return;
      }
      this.setHover(this.hit(event));
    };
    const up = (event: PointerEvent): void => {
      const drag = this.pointer;
      this.pointer = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (drag?.mode === "node" && drag.node !== undefined) {
        this.layout.release(drag.node);
        this.layout.reheat(0);
      }
    };
    const leave = (): void => {
      if (!this.pointer) this.setHover(undefined);
    };
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      this.autoFit = false;
      const box = canvas.getBoundingClientRect();
      const mx = event.clientX - box.left - box.width / 2;
      const my = event.clientY - box.top - box.height / 2;
      const camera = this.camera;
      const k = clamp(camera.k * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      // Zoom about the cursor: the world point under it stays put.
      camera.x = mx - ((mx - camera.x) * k) / camera.k;
      camera.y = my - ((my - camera.y) * k) / camera.k;
      camera.k = k;
      this.dirty = true;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
    };
  }

  private setHover(node: number | undefined): void {
    if (node === this.hover) return;
    this.hover = node;
    this.dirty = true;
    this.onHover(node === undefined ? undefined : this.map.nodes[node]);
  }

  private toWorld(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const box = this.canvas.getBoundingClientRect();
    const { k, x, y } = this.camera;
    return {
      x: (event.clientX - box.left - box.width / 2 - x) / k,
      y: (event.clientY - box.top - box.height / 2 - y) / k,
    };
  }

  private hit(event: { clientX: number; clientY: number }): number | undefined {
    const point = this.toWorld(event);
    let best: number | undefined;
    let bestDistance = Infinity;
    this.layout.nodes.forEach((node, at) => {
      const reach = nodeRadius(this.map.nodes[at]) + 5 / this.camera.k;
      const distance = Math.hypot(node.x - point.x, node.y - point.y);
      if (distance <= reach && distance < bestDistance) {
        best = at;
        bestDistance = distance;
      }
    });
    return best;
  }

  private draw(): void {
    const canvas = this.canvas;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    if (this.autoFit && width > 0 && height > 0) this.camera = this.fit(width, height);
    const style = getComputedStyle(canvas);
    const color = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    const palette = {
      ANIME: color("--taste-anime", "#4fb286"),
      MANGA: color("--taste-manga", "#d49a4a"),
      MORE: color("--taste-more", "#6f9fe0"),
      title: color("--taste-node", "#c3cac6"),
      line: color("--taste-line", "#7d8681"),
      label: color("--taste-label", "#d5dbd7"),
    };
    const { k, x: cx, y: cy } = this.camera;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.translate(width / 2 + cx, height / 2 + cy);
    context.scale(k, k);

    const { hover, focus } = this;
    const nodes = this.layout.nodes;
    const active = (at: number): boolean => {
      if (hover !== undefined) return at === hover || this.neighbors[hover].has(at);
      if (focus !== undefined) return this.map.nodes[at].cluster === focus;
      return true;
    };
    const dimmed = hover !== undefined || focus !== undefined;

    context.lineCap = "round";
    for (const link of this.links) {
      const lit = !dimmed || (active(link.source) && active(link.target));
      context.globalAlpha = lit ? (link.kind === "bridge" ? 0.35 : 0.18) + 0.3 * link.weight : 0.04;
      context.strokeStyle =
        lit && dimmed ? palette[this.map.nodes[link.source].section] : palette.line;
      context.lineWidth = (link.kind === "bridge" ? 1.4 : 0.8 + 0.8 * link.weight) / Math.sqrt(k);
      context.beginPath();
      context.moveTo(nodes[link.source].x, nodes[link.source].y);
      context.lineTo(nodes[link.target].x, nodes[link.target].y);
      context.stroke();
    }

    const labelAlpha = clamp((k - LABEL_ZOOM + 0.35) / 0.35, 0, 1);
    this.map.nodes.forEach((node, at) => {
      const lit = active(at);
      const position = nodes[at];
      const radius = nodeRadius(node);
      context.globalAlpha = lit ? 1 : 0.12;
      context.fillStyle = node.kind === "cluster" ? palette[node.section] : palette.title;
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
      if (at === hover) {
        context.lineWidth = 2 / k;
        context.strokeStyle = palette[node.section];
        context.stroke();
      }
      // Hubs are always named; titles when zoomed in, or as neighbours of the hovered node.
      const named = node.kind === "cluster" || at === hover || (hover !== undefined && lit);
      const alpha = named ? (lit ? 1 : 0.15) : lit ? labelAlpha * 0.85 : 0;
      if (alpha <= 0.02) return;
      context.globalAlpha = alpha;
      context.fillStyle = palette.label;
      const size = (node.kind === "cluster" ? 13 : 11) / Math.min(k, 1.6);
      context.font = `${node.kind === "cluster" ? 600 : 400} ${size}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(shorten(node.label), position.x, position.y + radius + 3 / k);
    });
    context.globalAlpha = 1;
  }

  private fit(width: number, height: number): Camera {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const node of this.layout.nodes) {
      x0 = Math.min(x0, node.x);
      y0 = Math.min(y0, node.y);
      x1 = Math.max(x1, node.x);
      y1 = Math.max(y1, node.y);
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, k: 1 };
    const k = clamp(
      Math.min(width / (x1 - x0 + 120), height / (y1 - y0 + 120)),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    return { x: (-(x0 + x1) / 2) * k, y: (-(y0 + y1) / 2) * k, k };
  }
}

function nodeRadius(node: TasteMapNode): number {
  return node.kind === "cluster"
    ? 7 + 13 * Math.sqrt(node.weight)
    : 2.5 + 4.5 * Math.sqrt(node.weight);
}

function shorten(label: string): string {
  return label.length > 32 ? `${label.slice(0, 31)}…` : label;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
