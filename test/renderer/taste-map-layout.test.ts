import { describe, expect, it } from "vitest";
import type { TasteMap } from "../../src/shared/taste-map";
import { ForceLayout } from "../../src/renderer/src/taste-map-layout";

function star(cluster: number, size: number): Pick<TasteMap, "nodes" | "links"> {
  const hub = `cluster:${cluster}`;
  const titles = Array.from({ length: size }, (_, at) => `ANIME:${cluster * 100 + at}`);
  return {
    nodes: [
      { id: hub, kind: "cluster", label: `Taste ${cluster}`, section: "ANIME", weight: 1, cluster },
      ...titles.map((id) => ({
        id,
        kind: "title" as const,
        label: id,
        section: "ANIME" as const,
        weight: 0.5,
        cluster,
      })),
    ],
    links: titles.map((id) => ({ source: hub, target: id, weight: 0.8, kind: "cluster" as const })),
  };
}

function map(): TasteMap {
  const a = star(0, 12);
  const b = star(1, 12);
  return {
    nodes: [...a.nodes, ...b.nodes],
    links: [...a.links, ...b.links],
    clusters: [],
    titles: 24,
    builtAt: 0,
  };
}

describe("taste map force layout", () => {
  it("settles with titles near their own hub and the two tastes apart", () => {
    const layout = new ForceLayout(map());
    layout.tick(400);
    expect(layout.settled).toBe(true);
    const at = (index: number) => layout.nodes[index];
    const distance = (a: number, b: number) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    for (const node of layout.nodes) expect(Number.isFinite(node.x + node.y)).toBe(true);
    const hubs = distance(0, 13);
    for (let title = 1; title <= 12; title += 1) {
      expect(distance(title, 0)).toBeLessThan(distance(title, 13));
      expect(distance(title, 0)).toBeLessThan(hubs);
    }
  });

  it("is deterministic, and a pinned node stays where it is held", () => {
    const first = new ForceLayout(map());
    const second = new ForceLayout(map());
    first.tick(200);
    second.tick(200);
    expect(first.nodes.map((node) => [node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.x, node.y]),
    );
    first.pin(3, 500, -200);
    first.reheat(0.3);
    first.tick(50);
    expect(first.nodes[3]).toMatchObject({ x: 500, y: -200 });
    first.release(3);
    first.reheat(0);
    first.tick(300);
    expect(first.nodes[3].x).toBeLessThan(500);
  });
});
