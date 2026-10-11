import type { TasteMap, TasteMapLink } from "../../shared/taste-map";

/**
 * Force-directed layout for the taste map, after d3-force: velocity Verlet with a cooling alpha,
 * many-body repulsion through a Barnes–Hut quadtree (O(n log n), θ = 0.9), springs whose
 * strength is 1 / min(degree) so busy hubs are not over-pulled, and a weak pull to the centre.
 * Seeded deterministically: hubs on a circle, each title near its hub on a golden-angle spiral.
 */
export interface LayoutNode {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Many-body strength; negative repels. */
  charge: number;
  /** Set while dragged: the node stays here. */
  fx?: number;
  fy?: number;
}

interface LayoutLink {
  source: number;
  target: number;
  length: number;
  strength: number;
  /** Share of the correction the target takes (by degree, as d3 does). */
  bias: number;
}

const ALPHA_MIN = 0.001;
/** d3's default: alpha reaches ALPHA_MIN after about 300 ticks. */
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.4;
const THETA2 = 0.81;
const DISTANCE_MIN2 = 1;
const DISTANCE_MAX2 = 1600 * 1600;
const GRAVITY = 0.035;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LENGTH: Record<TasteMapLink["kind"], number> = {
  cluster: 46,
  series: 34,
  recommended: 58,
  similar: 66,
  bridge: 260,
};

export class ForceLayout {
  readonly nodes: LayoutNode[];
  private readonly links: LayoutLink[];
  alpha = 1;
  private alphaTarget = 0;

  constructor(map: TasteMap) {
    const index = new Map(map.nodes.map((node, at) => [node.id, at]));
    const degree = map.nodes.map(() => 0);
    const pairs = map.links.flatMap((link) => {
      const source = index.get(link.source);
      const target = index.get(link.target);
      if (source === undefined || target === undefined) return [];
      degree[source] += 1;
      degree[target] += 1;
      return [{ source, target, link }];
    });
    this.links = pairs.map(({ source, target, link }) => ({
      source,
      target,
      length: LENGTH[link.kind] * (link.kind === "bridge" ? 1 : 1.25 - 0.5 * link.weight),
      strength: (0.35 + 0.65 * link.weight) / Math.min(degree[source], degree[target]),
      bias: degree[source] / (degree[source] + degree[target]),
    }));

    const hubs = map.nodes.filter((node) => node.kind === "cluster");
    const ring = 120 + 40 * Math.sqrt(hubs.length);
    const hubAt = new Map(
      hubs.map((hub, at) => {
        const angle = (2 * Math.PI * at) / Math.max(1, hubs.length);
        return [hub.cluster, { x: ring * Math.cos(angle), y: ring * Math.sin(angle) }];
      }),
    );
    const placed = new Map<number, number>();
    this.nodes = map.nodes.map((node, at) => {
      const center = hubAt.get(node.cluster) ?? { x: 0, y: 0 };
      let x = center.x;
      let y = center.y;
      if (node.kind === "title") {
        const rank = (placed.get(node.cluster) ?? 0) + 1;
        placed.set(node.cluster, rank);
        const radius = 18 * Math.sqrt(rank);
        x += radius * Math.cos(rank * GOLDEN_ANGLE);
        y += radius * Math.sin(rank * GOLDEN_ANGLE);
      }
      return {
        index: at,
        x,
        y,
        vx: 0,
        vy: 0,
        charge: node.kind === "cluster" ? -(160 + 420 * node.weight) : -(28 + 36 * node.weight),
      };
    });
  }

  get settled(): boolean {
    return this.alpha < ALPHA_MIN && this.alphaTarget === 0;
  }

  /** Holds a node at a point (while dragged). */
  pin(index: number, x: number, y: number): void {
    const node = this.nodes[index];
    node.fx = x;
    node.fy = y;
  }

  release(index: number): void {
    const node = this.nodes[index];
    delete node.fx;
    delete node.fy;
  }

  /** Wakes the simulation, e.g. while a node is dragged (target 0.3) or after it (0). */
  reheat(target: number): void {
    this.alphaTarget = target;
    if (this.alpha < target) this.alpha = target;
    if (target === 0 && this.alpha < 0.05) this.alpha = 0.05;
  }

  tick(count = 1): void {
    for (let step = 0; step < count; step += 1) {
      this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
      this.applyLinks();
      this.applyCharge();
      for (const node of this.nodes) {
        node.vx -= node.x * GRAVITY * this.alpha;
        node.vy -= node.y * GRAVITY * this.alpha;
      }
      for (const node of this.nodes) {
        if (node.fx !== undefined && node.fy !== undefined) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 1 - VELOCITY_DECAY;
        node.vy *= 1 - VELOCITY_DECAY;
        node.x += node.vx;
        node.y += node.vy;
      }
    }
  }

  private applyLinks(): void {
    for (const link of this.links) {
      const source = this.nodes[link.source];
      const target = this.nodes[link.target];
      let dx = target.x + target.vx - source.x - source.vx || jiggle(link.source);
      let dy = target.y + target.vy - source.y - source.vy || jiggle(link.target);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const pull = ((distance - link.length) / distance) * this.alpha * link.strength;
      dx *= pull;
      dy *= pull;
      target.vx -= dx * link.bias;
      target.vy -= dy * link.bias;
      source.vx += dx * (1 - link.bias);
      source.vy += dy * (1 - link.bias);
    }
  }

  private applyCharge(): void {
    const tree = buildQuadtree(this.nodes);
    if (!tree) return;
    for (const node of this.nodes) this.visit(tree, node);
  }

  private visit(quad: Quad, node: LayoutNode): void {
    if (!quad.charge) return;
    const dx = quad.cx - node.x;
    const dy = quad.cy - node.y;
    const width = quad.x1 - quad.x0;
    let d2 = dx * dx + dy * dy;
    if (!quad.children) {
      for (const other of quad.points) {
        if (other === node.index) continue;
        const peer = this.nodes[other];
        let px = peer.x - node.x || jiggle(other);
        let py = peer.y - node.y || jiggle(node.index);
        let p2 = px * px + py * py;
        if (p2 >= DISTANCE_MAX2) continue;
        if (p2 < DISTANCE_MIN2) p2 = Math.sqrt(DISTANCE_MIN2 * p2);
        const force = (peer.charge * this.alpha) / p2;
        px *= force;
        py *= force;
        node.vx += px;
        node.vy += py;
      }
      return;
    }
    // Far enough away (cell width / distance < θ): the cell acts as one body at its centre.
    if ((width * width) / THETA2 < d2) {
      if (d2 >= DISTANCE_MAX2) return;
      if (d2 < DISTANCE_MIN2) d2 = Math.sqrt(DISTANCE_MIN2 * d2);
      const force = (quad.charge * this.alpha) / d2;
      node.vx += dx * force;
      node.vy += dy * force;
      return;
    }
    for (const child of quad.children) if (child) this.visit(child, node);
  }
}

interface Quad {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Total charge of the cell and its charge-weighted centre. */
  charge: number;
  cx: number;
  cy: number;
  points: number[];
  children?: Array<Quad | undefined>;
}

const MAX_DEPTH = 24;

function buildQuadtree(nodes: LayoutNode[]): Quad | undefined {
  if (!nodes.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const node of nodes) {
    x0 = Math.min(x0, node.x);
    y0 = Math.min(y0, node.y);
    x1 = Math.max(x1, node.x);
    y1 = Math.max(y1, node.y);
  }
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const root: Quad = { x0, y0, x1: x0 + size, y1: y0 + size, charge: 0, cx: 0, cy: 0, points: [] };
  for (const node of nodes) insert(root, node, nodes, 0);
  accumulate(root, nodes);
  return root;
}

function insert(quad: Quad, node: LayoutNode, nodes: LayoutNode[], depth: number): void {
  if (quad.children) {
    insert(child(quad, node), node, nodes, depth + 1);
    return;
  }
  quad.points.push(node.index);
  if (quad.points.length < 2 || depth >= MAX_DEPTH) return;
  // A second point splits the leaf; points at the same spot stay together at MAX_DEPTH.
  const points = quad.points;
  quad.points = [];
  quad.children = [undefined, undefined, undefined, undefined];
  for (const at of points) insert(child(quad, nodes[at]), nodes[at], nodes, depth + 1);
}

function child(quad: Quad, node: LayoutNode): Quad {
  const mx = (quad.x0 + quad.x1) / 2;
  const my = (quad.y0 + quad.y1) / 2;
  const right = node.x >= mx ? 1 : 0;
  const bottom = node.y >= my ? 1 : 0;
  const slot = bottom * 2 + right;
  const children = quad.children!;
  children[slot] ??= {
    x0: right ? mx : quad.x0,
    y0: bottom ? my : quad.y0,
    x1: right ? quad.x1 : mx,
    y1: bottom ? quad.y1 : my,
    charge: 0,
    cx: 0,
    cy: 0,
    points: [],
  };
  return children[slot];
}

function accumulate(quad: Quad, nodes: LayoutNode[]): void {
  let charge = 0;
  let weight = 0;
  let x = 0;
  let y = 0;
  const add = (value: number, px: number, py: number): void => {
    const magnitude = Math.abs(value);
    charge += value;
    weight += magnitude;
    x += px * magnitude;
    y += py * magnitude;
  };
  if (quad.children) {
    for (const part of quad.children) {
      if (!part) continue;
      accumulate(part, nodes);
      add(part.charge, part.cx, part.cy);
    }
  } else for (const at of quad.points) add(nodes[at].charge, nodes[at].x, nodes[at].y);
  quad.charge = charge;
  quad.cx = weight ? x / weight : (quad.x0 + quad.x1) / 2;
  quad.cy = weight ? y / weight : (quad.y0 + quad.y1) / 2;
}

/** A tiny deterministic nudge so coincident points can separate. */
function jiggle(seed: number): number {
  return ((((seed * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * 1e-6;
}
