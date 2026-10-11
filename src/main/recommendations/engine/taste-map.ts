/**
 * The taste map (user request 2026-10-10, after Obsidian's graph view): liked titles as a graph,
 * clustered into tastes and compressed to a fixed node budget so it stays readable as history
 * grows. Steps:
 *
 * 1. Weight: affinity × recency (the ranker's half-life), liked titles only.
 * 2. Link: exact relations (sequels, adaptations, a film series), provider recommendations between
 *    liked titles, and each title's strongest IDF-cosine neighbours (top K above a floor).
 * 3. Cluster: Louvain modularity optimisation (Blondel et al. 2008), deterministic order.
 * 4. Name: each cluster by its most distinctive genres/tags (class-based TF-IDF lift).
 * 5. Compress: the node budget is shared by √(cluster weight); a cluster's weaker titles fold into
 *    its hub, and edges between clusters become hub-to-hub bridges.
 */
import {
  HYBRID_WEIGHTS,
  recommendationSection,
  type RecommendationItemFeatures,
  type RecommendationSection,
} from "../../../shared/recommendations";
import type {
  TasteMap,
  TasteMapCluster,
  TasteMapLink,
  TasteMapNode,
  TasteTrend,
} from "../../../shared/taste-map";
import { compareItems, ContentSpace, dot, edgeKey, itemKey, type Vector } from "./content";
import { NOT_A_THEME, themeLabel } from "./rows";
import type { HybridHistoryItem } from "./types";

const DAY_MS = 86_400_000;
/** Liked titles considered (strongest first); older, weaker ones only matter through decay. */
const MAX_TITLES = 600;
/** Title nodes drawn; the rest fold into their cluster hub. */
const NODE_BUDGET = 120;
const MAX_CLUSTERS = 18;
const NEIGHBORS = 4;
const MIN_SIMILARITY = 0.3;
/** A lone title joins the cluster whose centroid it is at least this close to. */
const MIN_ATTACH = 0.15;
const BRIDGES_PER_CLUSTER = 3;
const MIN_BRIDGE = 0.02;
const LOUVAIN_LEVELS = 6;
const LOUVAIN_PASSES = 30;
const TREND_DAYS = 90;
const MIN_LABEL_SHARE = 0.25;
/** AniList tags that describe a cast rather than a taste; never used to name a cluster. */
const NOT_A_LABEL = new Set([
  "male protagonist",
  "female protagonist",
  "heterosexual",
  "primarily male cast",
  "primarily female cast",
  "primarily adult cast",
  "primarily teen cast",
  "primarily child cast",
  "ensemble cast",
  "anthropomorphism",
  "3d animation",
  "computer animation",
  "cgi",
]);
const FADING_DAYS = 365;
const RELATED = new Set([
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ADAPTATION",
  "SOURCE",
  "ALTERNATIVE",
]);

interface Title {
  features: RecommendationItemFeatures;
  key: string;
  section: RecommendationSection;
  affinity: number;
  occurredAt: number;
  weight: number;
}

type Adjacency = Array<Map<number, number>>;

export function buildTasteMap(
  history: HybridHistoryItem[],
  now: number,
  options: { budget?: number } = {},
): TasteMap {
  const titles = likedTitles(history, now);
  if (!titles.length) return { nodes: [], links: [], clusters: [], titles: 0, builtAt: now };
  const space = new ContentSpace(titles.map((title) => title.features));
  const vectors = titles.map((title) => space.vector(title.features));
  const { adjacency, kinds } = linkTitles(titles, vectors);
  const { membership, otherFrom } = groupClusters(titles, vectors, louvain(adjacency));
  return compress(
    { titles, vectors, adjacency, kinds, membership, otherFrom },
    now,
    options.budget ?? NODE_BUDGET,
  );
}

/** One row per title (strongest signal, latest time), liked only, weighted, strongest first. */
function likedTitles(history: HybridHistoryItem[], now: number): Title[] {
  const halfLife = HYBRID_WEIGHTS.halfLifeDays * DAY_MS;
  const byKey = new Map<string, Title>();
  for (const row of history) {
    const key = itemKey(row.features);
    const known = byKey.get(key);
    const affinity = Math.max(row.affinity, known?.affinity ?? -Infinity);
    const occurredAt = Math.max(row.occurredAt, known?.occurredAt ?? 0);
    byKey.set(key, {
      features: known?.features ?? row.features,
      key,
      section: recommendationSection(row.features.mediaType),
      affinity,
      occurredAt,
      weight: affinity * Math.pow(0.5, Math.max(0, now - occurredAt) / halfLife),
    });
  }
  return [...byKey.values()]
    .filter((title) => title.affinity > 0 && title.weight > 0)
    .sort((a, b) => b.weight - a.weight || compareItems(a.features, b.features))
    .slice(0, MAX_TITLES);
}

function linkTitles(
  titles: Title[],
  vectors: Vector[],
): { adjacency: Adjacency; kinds: Map<string, TasteMapLink["kind"]> } {
  const adjacency: Adjacency = titles.map(() => new Map());
  const kinds = new Map<string, TasteMapLink["kind"]>();
  const index = new Map(titles.map((title, at) => [title.key, at]));
  const link = (a: number, b: number, weight: number, kind: TasteMapLink["kind"]): void => {
    if (a === b || weight <= 0) return;
    // An exact relation names the link even when content similarity is as strong.
    if ((adjacency[a].get(b) ?? 0) >= weight && kind !== "series") return;
    weight = Math.max(weight, adjacency[a].get(b) ?? 0);
    adjacency[a].set(b, weight);
    adjacency[b].set(a, weight);
    kinds.set(pairKey(a, b), kind);
  };

  // Each title's strongest content neighbours.
  for (let a = 0; a < titles.length; a += 1) {
    const near: Array<{ b: number; similarity: number }> = [];
    for (let b = 0; b < titles.length; b += 1) {
      if (a === b) continue;
      const similarity = dot(vectors[a], vectors[b]);
      if (similarity >= MIN_SIMILARITY) near.push({ b, similarity });
    }
    near.sort((x, y) => y.similarity - x.similarity || x.b - y.b);
    for (const { b, similarity } of near.slice(0, NEIGHBORS)) link(a, b, similarity, "similar");
  }

  // Provider recommendations between two liked titles.
  titles.forEach((title, a) => {
    const edges = title.features.recommendations ?? [];
    const best = Math.max(1, ...edges.map((edge) => edge.rating));
    for (const edge of edges) {
      const b = index.get(edgeKey(edge));
      if (b !== undefined)
        link(a, b, 0.4 + 0.6 * (Math.log1p(edge.rating) / Math.log1p(best)), "recommended");
    }
  });

  // Exact relations (sequels, the same work in the other section) and film series in order.
  titles.forEach((title, a) => {
    for (const relation of title.features.relations ?? []) {
      const b = index.get(edgeKey(relation));
      if (b !== undefined && RELATED.has(relation.relationType)) link(a, b, 1, "series");
    }
  });
  const series = new Map<number, number[]>();
  titles.forEach((title, at) => {
    const id = title.features.collectionId;
    if (id) series.set(id, [...(series.get(id) ?? []), at]);
  });
  for (const members of series.values()) {
    members.sort((a, b) => releaseOrder(titles[a]) - releaseOrder(titles[b]) || a - b);
    for (let at = 1; at < members.length; at += 1) link(members[at - 1], members[at], 1, "series");
  }
  return { adjacency, kinds };
}

function releaseOrder(title: Title): number {
  const { startedOn, releaseDate } = title.features;
  if (startedOn !== undefined) return startedOn;
  const parsed = releaseDate ? Number(releaseDate.slice(0, 10).replaceAll("-", "")) : NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Louvain community detection: move each node to the neighbouring community with the best
 * modularity gain ΔQ ∝ k_i,in − k_i·Σ_tot / 2m until nothing moves, then merge each community
 * into one node and repeat. Returns a community index per original node.
 */
export function louvain(adjacency: Adjacency): number[] {
  let graph = adjacency;
  let membership = adjacency.map((_, at) => at);
  for (let level = 0; level < LOUVAIN_LEVELS; level += 1) {
    const { community, moved } = localMoves(graph);
    if (!moved) break;
    const renumber = new Map<number, number>();
    for (const value of community) if (!renumber.has(value)) renumber.set(value, renumber.size);
    const compact = community.map((value) => renumber.get(value)!);
    membership = membership.map((node) => compact[node]);
    const next: Adjacency = Array.from({ length: renumber.size }, () => new Map());
    graph.forEach((neighbors, a) => {
      for (const [b, weight] of neighbors) {
        const target = next[compact[a]];
        target.set(compact[b], (target.get(compact[b]) ?? 0) + weight);
      }
    });
    graph = next;
  }
  return membership;
}

function localMoves(graph: Adjacency): { community: number[]; moved: boolean } {
  const degree = graph.map((neighbors) => [...neighbors.values()].reduce((a, b) => a + b, 0));
  const total = degree.reduce((a, b) => a + b, 0);
  const community = graph.map((_, at) => at);
  if (total <= 0) return { community, moved: false };
  const sum = [...degree];
  let moved = false;
  for (let pass = 0; pass < LOUVAIN_PASSES; pass += 1) {
    let changed = false;
    for (let node = 0; node < graph.length; node += 1) {
      const own = community[node];
      const links = new Map<number, number>();
      for (const [other, weight] of graph[node])
        if (other !== node)
          links.set(community[other], (links.get(community[other]) ?? 0) + weight);
      sum[own] -= degree[node];
      const gain = (target: number) =>
        (links.get(target) ?? 0) - (sum[target] * degree[node]) / total;
      let best = own;
      let bestGain = gain(own);
      for (const target of links.keys()) {
        const value = gain(target);
        // Strictly better only, so ties keep the node where it is and the result is stable.
        if (value > bestGain + 1e-12) {
          best = target;
          bestGain = value;
        }
      }
      sum[best] += degree[node];
      if (best !== own) {
        community[node] = best;
        changed = true;
        moved = true;
      }
    }
    if (!changed) break;
  }
  return { community, moved };
}

/**
 * Lone titles join the cluster whose centroid they are closest to, or their section's "other"
 * cluster; past MAX_CLUSTERS the weakest clusters fold into "other" too. Returns compact IDs,
 * strongest cluster first.
 */
function groupClusters(
  titles: Title[],
  vectors: Vector[],
  raw: number[],
): { membership: number[]; otherFrom: number } {
  const members = new Map<number, number[]>();
  raw.forEach((cluster, at) => members.set(cluster, [...(members.get(cluster) ?? []), at]));
  const weightOf = (list: number[]) => list.reduce((sum, at) => sum + titles[at].weight, 0);
  const real = [...members.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => weightOf(b[1]) - weightOf(a[1]) || a[0] - b[0])
    .slice(0, MAX_CLUSTERS);
  const kept = new Set(real.map(([cluster]) => cluster));
  const centroids = real.map(([, list]) => {
    const centroid: Vector = new Map();
    for (const at of list)
      for (const [feature, value] of vectors[at])
        centroid.set(feature, (centroid.get(feature) ?? 0) + value * titles[at].weight);
    const norm = Math.sqrt([...centroid.values()].reduce((sum, v) => sum + v * v, 0)) || 1;
    for (const [feature, value] of centroid) centroid.set(feature, value / norm);
    return centroid;
  });
  const order = new Map(real.map(([cluster], at) => [cluster, at]));
  const other = new Map<RecommendationSection, number>();
  const membership = raw.map((cluster, at) => {
    if (kept.has(cluster)) return order.get(cluster)!;
    let best = -1;
    let bestValue = MIN_ATTACH;
    centroids.forEach((centroid, index) => {
      const value = dot(centroid, vectors[at]);
      if (value > bestValue) {
        best = index;
        bestValue = value;
      }
    });
    if (best >= 0) return best;
    const section = titles[at].section;
    if (!other.has(section)) other.set(section, real.length + other.size);
    return other.get(section)!;
  });
  return { membership, otherFrom: real.length };
}

interface Clustered {
  titles: Title[];
  vectors: Vector[];
  adjacency: Adjacency;
  kinds: Map<string, TasteMapLink["kind"]>;
  membership: number[];
  /** Cluster IDs from here on are the per-section "other" buckets. */
  otherFrom: number;
}

function compress(graph: Clustered, now: number, budget: number): TasteMap {
  const { titles, adjacency, kinds, membership } = graph;
  const count = Math.max(...membership) + 1;
  const members: number[][] = Array.from({ length: count }, () => []);
  membership.forEach((cluster, at) => members[cluster].push(at));
  const weights = members.map((list) => list.reduce((sum, at) => sum + titles[at].weight, 0));
  const used = members.map((list) => list.length > 0);
  const labels = clusterLabels(graph, members);

  // √-weighted share of the node budget, at least one title per cluster.
  const roots = weights.map((weight, cluster) => (used[cluster] ? Math.sqrt(weight) : 0));
  const rootSum = roots.reduce((a, b) => a + b, 0) || 1;
  const quota = members.map((list, cluster) =>
    Math.min(list.length, Math.max(1, Math.round((budget * roots[cluster]) / rootSum))),
  );
  for (let over = quota.reduce((a, b) => a + b, 0) - budget; over > 0; over -= 1) {
    let largest = -1;
    quota.forEach((value, cluster) => {
      if (value > 1 && (largest < 0 || value > quota[largest])) largest = cluster;
    });
    if (largest < 0) break;
    quota[largest] -= 1;
  }
  const shown = new Set<number>();
  members.forEach((list, cluster) => {
    for (const at of list.slice(0, quota[cluster])) shown.add(at);
  });

  const maxTitle = titles[0].weight;
  const maxCluster = Math.max(...weights);
  const clusters: TasteMapCluster[] = [];
  const nodes: TasteMapNode[] = [];
  const links: TasteMapLink[] = [];
  members.forEach((list, cluster) => {
    if (!list.length) return;
    const section = mainSection(list.map((at) => titles[at]));
    const trend = clusterTrend(
      list.map((at) => titles[at]),
      now,
    );
    clusters.push({
      id: cluster,
      label: labels[cluster],
      section,
      weight: weights[cluster] / maxCluster,
      titles: list.length,
      trend,
    });
    const hub = `cluster:${cluster}`;
    nodes.push({
      id: hub,
      kind: "cluster",
      label: labels[cluster],
      section,
      weight: weights[cluster] / maxCluster,
      cluster,
      folded: list.length - quota[cluster],
    });
    const strongest = titles[list[0]].weight;
    for (const at of list.slice(0, quota[cluster])) {
      const title = titles[at];
      nodes.push({
        id: title.key,
        kind: "title",
        label: title.features.normalizedTitle,
        section: title.section,
        mediaType: title.features.mediaType,
        mediaId: title.features.anilistId,
        weight: title.weight / maxTitle,
        cluster,
        coverUrl: title.features.coverUrl,
      });
      links.push({
        source: hub,
        target: title.key,
        weight: 0.3 + 0.7 * (title.weight / strongest),
        kind: "cluster",
      });
    }
  });

  // Title links among shown titles; links that cross clusters also add up into bridges.
  const bridges = new Map<string, number>();
  const strength = new Array<number>(count).fill(0);
  adjacency.forEach((neighbors, a) => {
    for (const [b, weight] of neighbors) {
      if (b <= a) continue;
      if (shown.has(a) && shown.has(b))
        links.push({
          source: titles[a].key,
          target: titles[b].key,
          weight,
          kind: kinds.get(pairKey(a, b)) ?? "similar",
        });
      const ca = membership[a];
      const cb = membership[b];
      strength[ca] += weight;
      strength[cb] += weight;
      if (ca !== cb) {
        const key = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`;
        bridges.set(key, (bridges.get(key) ?? 0) + weight);
      }
    }
  });
  const scored = [...bridges.entries()].map(([key, total]) => {
    const [ca, cb] = key.split("|").map(Number);
    return { ca, cb, value: total / Math.sqrt(Math.max(1e-9, strength[ca] * strength[cb])) };
  });
  const perCluster = new Map<number, number>();
  const maxBridge = Math.max(1e-9, ...scored.map((row) => row.value));
  for (const row of scored.sort((a, b) => b.value - a.value || a.ca - b.ca || a.cb - b.cb)) {
    if (row.value < MIN_BRIDGE) break;
    if ((perCluster.get(row.ca) ?? 0) >= BRIDGES_PER_CLUSTER) continue;
    if ((perCluster.get(row.cb) ?? 0) >= BRIDGES_PER_CLUSTER) continue;
    perCluster.set(row.ca, (perCluster.get(row.ca) ?? 0) + 1);
    perCluster.set(row.cb, (perCluster.get(row.cb) ?? 0) + 1);
    links.push({
      source: `cluster:${row.ca}`,
      target: `cluster:${row.cb}`,
      weight: row.value / maxBridge,
      kind: "bridge",
    });
  }
  return { nodes, links, clusters, titles: titles.length, builtAt: now };
}

/**
 * Names each cluster by its two most distinctive genres or tags: the weighted share p of the
 * cluster's titles carrying a feature, scaled by its lift over the whole map, p × ln(1 + p / p_all).
 * A feature must be carried by at least a quarter of the cluster, so one rare tag cannot name it.
 * Clusters never share a name; the "other" buckets are named after their section.
 */
function clusterLabels({ titles, vectors, otherFrom }: Clustered, members: number[][]): string[] {
  const names = new Map<string, string>();
  for (const title of titles) {
    for (const genre of title.features.genres) names.set(`g:${genre}`, genre);
    for (const tag of title.features.tags) {
      const lower = tag.name.toLocaleLowerCase();
      if (NOT_A_LABEL.has(lower) || NOT_A_THEME.has(lower)) continue;
      const key = `t:${lower}`;
      if (!names.has(key)) names.set(key, themeLabel(tag.name));
    }
  }
  const share = (list: number[]): Map<string, number> => {
    const totals = new Map<string, number>();
    let weight = 0;
    for (const at of list) {
      weight += titles[at].weight;
      for (const feature of vectors[at].keys())
        if (names.has(feature)) totals.set(feature, (totals.get(feature) ?? 0) + titles[at].weight);
    }
    for (const [feature, value] of totals) totals.set(feature, value / (weight || 1));
    return totals;
  };
  const overall = share(titles.map((_, at) => at));
  const taken = new Set<string>();
  return members.map((list, cluster) => {
    if (!list.length) return "";
    if (cluster >= otherFrom)
      return `Other ${sectionName(mainSection(list.map((at) => titles[at])))} tastes`;
    const ranked = [...share(list).entries()]
      .filter(([, value]) => value >= MIN_LABEL_SHARE)
      .map(([feature, value]) => ({
        name: names.get(feature)!,
        score: value * Math.log(1 + value / ((overall.get(feature) ?? 0) + 1e-9)),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((row) => row.name);
    if (!ranked.length) {
      const name = sectionName(mainSection(list.map((at) => titles[at])));
      return `${name[0].toUpperCase()}${name.slice(1)} picks`;
    }
    let label = ranked.slice(0, 2).join(" · ");
    for (let second = 2; taken.has(label) && second < ranked.length; second += 1)
      label = `${ranked[0]} · ${ranked[second]}`;
    if (taken.has(label)) label = `${label} (${taken.size + 1})`;
    taken.add(label);
    return label;
  });
}

function mainSection(list: Title[]): RecommendationSection {
  const totals = new Map<RecommendationSection, number>();
  for (const title of list)
    totals.set(title.section, (totals.get(title.section) ?? 0) + title.weight);
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function sectionName(section: RecommendationSection): string {
  return section === "MORE" ? "movie & TV" : section === "ANIME" ? "anime" : "manga";
}

/**
 * Growing: at least two titles and a third of the cluster's affinity in the last 90 days.
 * Fading: nothing added for a year. Otherwise steady.
 */
function clusterTrend(list: Title[], now: number): TasteTrend {
  const recent = list.filter((title) => now - title.occurredAt <= TREND_DAYS * DAY_MS);
  const total = list.reduce((sum, title) => sum + title.affinity, 0);
  const recentTotal = recent.reduce((sum, title) => sum + title.affinity, 0);
  if (recent.length >= 2 && recentTotal >= total / 3) return "growing";
  const newest = Math.max(...list.map((title) => title.occurredAt));
  return now - newest > FADING_DAYS * DAY_MS ? "fading" : "steady";
}
