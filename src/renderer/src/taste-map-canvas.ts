import type { RecommendationSection } from "../../shared/recommendations";
import type { TasteMap, TasteMapLink, TasteMapNode } from "../../shared/taste-map";
import { ForceLayout } from "./taste-map-layout";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Every lit title is named from this zoom (picked or hovered titles are always named). */
const LABEL_ZOOM = 1.6;
/** Ticks run before the first frame, so the map opens nearly settled. */
const WARM_TICKS = 140;
const CAMERA_MS = 420;
/** A press that moves less than this is a click (on a hub: pick its taste). */
const CLICK_SLOP = 4;
/** Label halos and cover backs use the app background (`--ink`), read when drawing. */
const LABEL_HALO_FALLBACK = "#070807";
const LABEL_TEXT = "#f3f6f4";
const LABEL_TITLE = "#dfe5e1";
const LABEL_MUTED = "#6f7873";

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
  startX: number;
  startY: number;
}

/** Screen space the floating controls cover; the camera frames the map inside the rest. */
export interface TasteMapInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A hovered node and where it sits on the canvas (CSS pixels from its top-left). */
export interface TasteMapHover {
  node: TasteMapNode;
  x: number;
  y: number;
  radius: number;
  /** The canvas size, for keeping a card beside the node inside the window. */
  width: number;
  height: number;
}

type Box = [x0: number, y0: number, x1: number, y1: number];

/**
 * Draws the taste map on a canvas and runs its interaction: drag a node (it stays pinned while
 * held), drag the background to pan, scroll to zoom about the cursor, hover to light a node and
 * its neighbours, click a hub to pick its taste. A picked taste shows its titles as covers; a
 * section filter fades the other sections. Labels are placed biggest first and skipped where they
 * would overlap. Imperative on purpose: it redraws every animation frame while the layout moves.
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
  /** Titles per cluster id, for sizing hubs and ordering their labels. */
  private readonly clusterTitles: Map<number, number>;
  private readonly maxClusterTitles: number;
  private camera: Camera = { x: 0, y: 0, k: 1 };
  private tween?: { from: Camera; to: Camera; start: number };
  /** The camera frames the whole map while it settles, until the viewer pans, zooms or drags. */
  private autoFit = true;
  private insets: TasteMapInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private pointer?: Pointer;
  private hover?: number;
  private focus?: number;
  /** Nodes outside the picked taste that link into it (shown half-lit). */
  private focusNeighbors = new Set<number>();
  private section?: RecommendationSection;
  private readonly covers = new Map<string, HTMLImageElement | null>();
  private dirty = true;
  private frame = 0;
  private readonly observer: ResizeObserver;
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: TasteMap,
    private readonly onHover: (hover: TasteMapHover | undefined) => void,
    private readonly reducedMotion: boolean,
    private readonly onPickCluster?: (cluster: number) => void,
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
    this.clusterTitles = new Map(map.clusters.map((cluster) => [cluster.id, cluster.titles]));
    this.maxClusterTitles = Math.max(1, ...map.clusters.map((cluster) => cluster.titles));
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

  setInsets(insets: TasteMapInsets): void {
    this.insets = insets;
    this.dirty = true;
  }

  /** Lights one taste and frames its titles; undefined clears it and frames the map again. */
  setFocus(cluster: number | undefined): void {
    if (cluster === this.focus) return;
    const had = this.focus !== undefined;
    this.focus = cluster;
    this.focusNeighbors = new Set();
    this.dirty = true;
    if (cluster === undefined) {
      if (had) this.frameView();
      return;
    }
    const members: number[] = [];
    this.map.nodes.forEach((node, at) => {
      if (node.cluster === cluster) members.push(at);
    });
    for (const at of members) this.cover(this.map.nodes[at]);
    for (const at of members)
      for (const next of this.neighbors[at])
        if (this.map.nodes[next].cluster !== cluster) this.focusNeighbors.add(next);
    this.autoFit = false;
    this.moveTo(this.frameNodes(members, 2.6));
  }

  /** Fades every section but this one and frames it; undefined shows and frames all. */
  setSection(section: RecommendationSection | undefined): void {
    if (section === this.section) return;
    this.section = section;
    this.dirty = true;
    if (this.focus === undefined) this.frameView();
  }

  /** Zooms about the middle of the free area (the + and − buttons). */
  zoomBy(factor: number): void {
    this.autoFit = false;
    const target = this.tween?.to ?? this.camera;
    const { width, height } = this.size();
    const mx = this.insets.left + (width - this.insets.left - this.insets.right) / 2 - width / 2;
    const my = this.insets.top + (height - this.insets.top - this.insets.bottom) / 2 - height / 2;
    const k = clamp(target.k * factor, MIN_ZOOM, MAX_ZOOM);
    this.moveTo({
      x: mx - ((mx - target.x) * k) / target.k,
      y: my - ((my - target.y) * k) / target.k,
      k,
    });
  }

  /** The fit button: frames the picked taste, the filtered section, or the whole map. */
  fitAll(): void {
    if (this.focus === undefined) return this.frameView();
    const focus = this.focus;
    const members = this.layout.nodes
      .map((_, at) => at)
      .filter((at) => this.map.nodes[at].cluster === focus);
    this.moveTo(this.frameNodes(members, 2.6));
  }

  /** Frames the section filter's nodes (or everything), and follows the map while it settles. */
  private frameView(): void {
    const all = this.layout.nodes.map((_, at) => at);
    const shown = this.section
      ? all.filter((at) => this.map.nodes[at].section === this.section)
      : all;
    this.moveTo(this.frameNodes(shown.length ? shown : all, MAX_ZOOM));
    this.autoFit = !this.section;
  }

  private moveTo(target: Camera): void {
    this.dirty = true;
    if (this.reducedMotion) {
      this.tween = undefined;
      this.camera = target;
      return;
    }
    this.tween = { from: { ...this.camera }, to: target, start: performance.now() };
  }

  private readonly loop = (): void => {
    if (!this.layout.settled) {
      this.layout.tick();
      this.dirty = true;
    }
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / CAMERA_MS);
      const ease = 1 - Math.pow(1 - t, 3);
      const { from, to } = this.tween;
      // Zoom moves geometrically so the scale change feels even.
      const k = from.k * Math.pow(to.k / from.k, ease);
      this.camera = {
        x: from.x + (to.x - from.x) * ease,
        y: from.y + (to.y - from.y) * ease,
        k,
      };
      if (t >= 1) this.tween = undefined;
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
      this.tween = undefined;
      const node = this.hit(event);
      canvas.setPointerCapture(event.pointerId);
      this.pointer = {
        mode: node === undefined ? "pan" : "node",
        node,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
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
        this.reportHover();
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
        const node = this.map.nodes[drag.node];
        const still =
          Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CLICK_SLOP;
        if (still && node.kind === "cluster") this.onPickCluster?.(node.cluster);
      }
    };
    const leave = (): void => {
      if (!this.pointer) this.setHover(undefined);
    };
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      this.autoFit = false;
      this.tween = undefined;
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
      this.reportHover();
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
    if (node !== undefined) this.cover(this.map.nodes[node]);
    this.reportHover();
  }

  /** Tells the dialog where the hovered node is now (it moves with drags and zoom). */
  private reportHover(): void {
    const at = this.hover;
    if (at === undefined) return this.onHover(undefined);
    const { width, height } = this.size();
    const { k, x, y } = this.camera;
    const position = this.layout.nodes[at];
    this.onHover({
      node: this.map.nodes[at],
      x: width / 2 + x + position.x * k,
      y: height / 2 + y + position.y * k,
      radius: this.radius(at) * k,
      width,
      height,
    });
  }

  private size(): { width: number; height: number } {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
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
      const reach = this.radius(at) + 5 / this.camera.k;
      const distance = Math.hypot(node.x - point.x, node.y - point.y);
      if (distance <= reach && distance < bestDistance) {
        best = at;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** World radius: hubs grow with their taste's size; titles in the picked taste are covers. */
  private radius(at: number): number {
    const node = this.map.nodes[at];
    // Zoomed in, points grow more slowly than the map so a picked taste stays readable.
    const shrink = Math.max(1, Math.sqrt(this.camera.k));
    if (node.kind === "cluster")
      return (
        (9 + 15 * Math.sqrt((this.clusterTitles.get(node.cluster) ?? 1) / this.maxClusterTitles)) /
        shrink
      );
    if (this.showsCover(at)) return (13 + 9 * node.weight) / this.camera.k;
    return (2.6 + 3.2 * Math.sqrt(node.weight)) / shrink;
  }

  private showsCover(at: number): boolean {
    const node = this.map.nodes[at];
    if (node.kind !== "title" || !node.coverUrl) return false;
    // Until its cover has loaded a title stays a dot (and keeps a dot's size for hit tests).
    if (!this.covers.get(node.coverUrl)?.complete) return false;
    return at === this.hover || (this.focus !== undefined && node.cluster === this.focus);
  }

  /** Loads a cover once; the map redraws when it arrives. */
  private cover(node: TasteMapNode): HTMLImageElement | undefined {
    const url = node.coverUrl;
    if (!url) return undefined;
    const cached = this.covers.get(url);
    if (cached !== undefined) return cached?.complete ? cached : undefined;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      this.dirty = true;
    };
    image.onerror = () => this.covers.set(url, null);
    image.src = url;
    this.covers.set(url, image);
    return undefined;
  }

  /** How lit a node is (0..1) under the current hover, picked taste and section filter. */
  private light(at: number): number {
    const node = this.map.nodes[at];
    const { hover, focus, section } = this;
    if (hover !== undefined) return at === hover || this.neighbors[hover].has(at) ? 1 : 0.22;
    if (focus !== undefined)
      return node.cluster === focus ? 1 : this.focusNeighbors.has(at) ? 0.35 : 0.12;
    if (section) return node.section === section ? 1 : 0.1;
    return 1;
  }

  private draw(): void {
    const canvas = this.canvas;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.size();
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    if (this.autoFit && !this.tween && width > 0 && height > 0)
      this.camera = this.frameNodes(
        this.layout.nodes.map((_, at) => at),
        MAX_ZOOM,
      );
    const style = getComputedStyle(canvas);
    const color = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    const palette: Record<RecommendationSection, string> = {
      ANIME: color("--taste-anime", "#4fd19a"),
      MANGA: color("--taste-manga", "#e3a75c"),
      MORE: color("--taste-more", "#7fa9f2"),
    };
    const font = style.fontFamily || "system-ui, sans-serif";
    const halo = color("--ink", LABEL_HALO_FALLBACK);
    const { k, x: cx, y: cy } = this.camera;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2 + cx, height / 2 + cy);
    context.scale(k, k);

    const { hover, focus, section } = this;
    const nodes = this.layout.nodes;
    const meta = this.map.nodes;

    // Links: faint by default; the hovered node's or the picked taste's own links take its colour.
    context.lineCap = "round";
    for (const link of this.links) {
      const a = meta[link.source];
      const b = meta[link.target];
      let alpha = link.kind === "bridge" ? 0.05 : 0.085;
      let stroke = "#ffffff";
      if (hover !== undefined) {
        const touches = link.source === hover || link.target === hover;
        alpha = touches ? 0.6 : 0.03;
        if (touches) stroke = palette[meta[hover].section];
      } else if (focus !== undefined) {
        const inside = a.cluster === focus && b.cluster === focus;
        alpha = inside ? 0.42 : a.cluster === focus || b.cluster === focus ? 0.12 : 0.025;
        if (inside) stroke = palette[a.section];
      } else if (section) {
        alpha =
          a.section === section && b.section === section
            ? link.kind === "bridge"
              ? 0.06
              : 0.1
            : 0.02;
      }
      context.globalAlpha = alpha;
      context.strokeStyle = stroke;
      context.lineWidth = 1.1 / k;
      context.setLineDash(link.kind === "bridge" ? [2 / k, 5 / k] : []);
      context.beginPath();
      context.moveTo(nodes[link.source].x, nodes[link.source].y);
      context.lineTo(nodes[link.target].x, nodes[link.target].y);
      context.stroke();
    }
    context.setLineDash([]);

    // Titles under hubs: dots in their section's colour, or round covers when picked/hovered.
    meta.forEach((node, at) => {
      if (node.kind !== "title") return;
      const { x, y } = nodes[at];
      const light = this.light(at);
      const tint = palette[node.section];
      const r = this.radius(at);
      const image = this.showsCover(at) ? this.cover(node) : undefined;
      if (image) {
        context.globalAlpha = Math.max(0.3, light);
        context.fillStyle = halo;
        context.strokeStyle = tint;
        context.lineWidth = 1.6 / k;
        context.beginPath();
        context.arc(x, y, r + 2.5 / k, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.save();
        context.beginPath();
        context.arc(x, y, r, 0, Math.PI * 2);
        context.clip();
        // Covers are portrait: fill the circle with the middle of the poster.
        const scale = (2 * r) / Math.min(image.naturalWidth || 1, image.naturalHeight || 1);
        const w = (image.naturalWidth || 1) * scale;
        const h = (image.naturalHeight || 1) * scale;
        context.drawImage(image, x - w / 2, y - h / 2, w, h);
        context.restore();
        return;
      }
      context.globalAlpha = 0.78 * light;
      context.fillStyle = tint;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
      if (at === hover) {
        context.globalAlpha = 1;
        context.lineWidth = 2 / k;
        context.strokeStyle = tint;
        context.stroke();
      }
    });

    // Hubs: a soft halo, a tinted disc with a ring, and a centre point.
    meta.forEach((node, at) => {
      if (node.kind !== "cluster") return;
      const { x, y } = nodes[at];
      const light = this.light(at);
      const tint = palette[node.section];
      const r = this.radius(at);
      context.fillStyle = tint;
      context.globalAlpha = 0.07 * light;
      context.beginPath();
      context.arc(x, y, r + 7 / Math.max(1, Math.sqrt(k)), 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.2 * light;
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.95 * light;
      context.strokeStyle = tint;
      context.lineWidth = (at === hover ? 2.4 : 1.6) / k;
      context.stroke();
      context.globalAlpha = light;
      context.beginPath();
      context.arc(x, y, 3.2 / Math.max(1, k), 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
    context.globalAlpha = 1;
    this.drawLabels(context, width, height, font, halo);
  }

  /**
   * Labels in screen space, so text stays one size at any zoom. Placed in priority order; one that
   * would overlap a placed label or the floating controls tries above its node, then is skipped.
   */
  private drawLabels(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    font: string,
    halo: string,
  ): void {
    const { k, x: cx, y: cy } = this.camera;
    const { hover, focus, section, insets } = this;
    const nodes = this.layout.nodes;
    const meta = this.map.nodes;
    const placed: Box[] = [
      [0, 0, width, insets.top - 6],
      [0, height - insets.bottom + 6, width, height],
      [width - insets.right + 6, 0, width, height],
    ];
    const screen = (at: number): [number, number] => [
      width / 2 + cx + nodes[at].x * k,
      height / 2 + cy + nodes[at].y * k,
    ];
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = halo;
    const put = (text: string, x: number, y: number, size: number, fill: string): boolean => {
      context.font = `600 ${size}px ${font}`;
      const half = context.measureText(text).width / 2;
      const box: Box = [x - half - 3, y - size, x + half + 3, y + 4];
      if (box[0] < 8 || box[2] > width - 8) return false;
      if (placed.some((other) => overlaps(box, other))) return false;
      placed.push(box);
      context.fillStyle = fill;
      context.strokeText(text, x, y);
      context.fillText(text, x, y);
      return true;
    };
    const placeBelowOrAbove = (at: number, text: string, size: number, fill: string): void => {
      const [x, y] = screen(at);
      const r = this.radius(at) * k;
      if (!put(text, x, y + r + size + 5, size, fill)) put(text, x, y - r - 8, size, fill);
    };

    const hubs = meta
      .map((node, at) => ({ node, at }))
      .filter(({ node }) => node.kind === "cluster")
      .sort(
        (a, b) =>
          (this.clusterTitles.get(b.node.cluster) ?? 0) -
          (this.clusterTitles.get(a.node.cluster) ?? 0),
      );
    const placeHubs = (): void => {
      for (const { node, at } of hubs) {
        if (focus !== undefined && hover === undefined && node.cluster !== focus) continue;
        if (section && hover === undefined && focus === undefined && node.section !== section)
          continue;
        const lit = this.light(at) >= 1;
        placeBelowOrAbove(at, node.label, 13, lit ? LABEL_TEXT : LABEL_MUTED);
      }
    };
    const titles = meta
      .map((node, at) => ({ node, at }))
      .filter(({ node, at }) => {
        if (node.kind !== "title" || at === hover) return false;
        if (hover !== undefined) return this.neighbors[hover].has(at);
        if (focus !== undefined) return node.cluster === focus;
        return k >= LABEL_ZOOM && this.light(at) >= 1;
      })
      .sort((a, b) => b.node.weight - a.node.weight);
    const placeTitles = (): void => {
      for (const { node, at } of titles)
        placeBelowOrAbove(at, shorten(node.label), 12, LABEL_TITLE);
    };
    // Picked or hovered titles are what the viewer is looking at, so they get room first.
    if (hover !== undefined || focus !== undefined) {
      placeTitles();
      placeHubs();
    } else {
      placeHubs();
      placeTitles();
    }
  }

  /** A camera that fits these nodes inside the area the floating controls leave free. */
  private frameNodes(indexes: number[], maxZoom: number): Camera {
    const { width, height } = this.size();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const at of indexes) {
      const node = this.layout.nodes[at];
      x0 = Math.min(x0, node.x);
      y0 = Math.min(y0, node.y);
      x1 = Math.max(x1, node.x);
      y1 = Math.max(y1, node.y);
    }
    if (!Number.isFinite(x0) || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
    const { top, right, bottom, left } = this.insets;
    const freeWidth = Math.max(120, width - left - right);
    const freeHeight = Math.max(120, height - top - bottom);
    // Room for hub labels around the edge of the frame.
    const k = clamp(
      Math.min(freeWidth / (x1 - x0 + 140), freeHeight / (y1 - y0 + 120)),
      MIN_ZOOM,
      maxZoom,
    );
    const centerX = left + freeWidth / 2 - width / 2;
    const centerY = top + freeHeight / 2 - height / 2;
    return { x: centerX - ((x0 + x1) / 2) * k, y: centerY - ((y0 + y1) / 2) * k, k };
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function shorten(label: string): string {
  return label.length > 24 ? `${label.slice(0, 23)}…` : label;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
