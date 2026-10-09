// Offline leave-one-out evaluation of For You rankers against a personal library fixture.
// Run: npx vitest run -c vitest.eval.config.ts   (skips when no fixture is present)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  affinity,
  currentRanker,
  currentRichRanker,
  hybridPool,
  hybridRanker,
  meanScore,
  popularityRanker,
  shippedRanker,
  productionPool,
  type Fixture,
  type FixtureEntry,
  type FixtureMedia,
  type MediaType,
  type Ranker,
} from "./recommendation-lab";

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "personal");
const MAX_HOLDOUTS = 80;
const K = 10;
const FRANCHISE = new Set([
  "SEQUEL",
  "PREQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "SUMMARY",
]);

const fixtureFile = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).find((name) => /^anilist-.+\.json$/.test(name))
  : undefined;

interface Tally {
  n: number;
  hits: number;
  ndcg: number;
  rr: number;
  ranks: number[];
  inPool: number;
  genres: number;
  popularity: number;
  lists: number;
}

function tally(): Tally {
  return {
    n: 0,
    hits: 0,
    ndcg: 0,
    rr: 0,
    ranks: [],
    inPool: 0,
    genres: 0,
    popularity: 0,
    lists: 0,
  };
}

function record(t: Tally, ranked: number[], target: number, fixture: Fixture): void {
  t.n += 1;
  const index = ranked.indexOf(target);
  if (index >= 0) {
    t.inPool += 1;
    t.ranks.push(index + 1);
    t.rr += 1 / (index + 1);
    if (index < K) {
      t.hits += 1;
      t.ndcg += 1 / Math.log2(index + 2);
    }
  } else t.ranks.push(Infinity);
  const top = ranked
    .slice(0, K)
    .map((id) => fixture.media[id])
    .filter(Boolean);
  if (top.length) {
    t.lists += 1;
    t.genres += new Set(top.flatMap((media) => media.genres ?? [])).size;
    t.popularity += top.reduce((sum, media) => sum + (media.popularity ?? 0), 0) / top.length;
  }
}

function summarize(t: Tally) {
  const sorted = [...t.ranks].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
  return {
    n: t.n,
    "HR@10": round(t.hits / t.n),
    "NDCG@10": round(t.ndcg / t.n),
    MRR: round(t.rr / t.n),
    medianRank: Number.isFinite(median) ? median : "∞",
    inPool: round(t.inPool / t.n),
    genres: round(t.genres / Math.max(1, t.lists), 1),
    avgPop: Math.round(t.popularity / Math.max(1, t.lists)),
  };
}

function round(value: number, digits = 3): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : NaN;
}

function hash(value: number): number {
  let x = value ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function isFranchise(target: FixtureMedia, history: FixtureEntry[], fixture: Fixture): boolean {
  const historyIds = new Set(history.map((entry) => entry.mediaId));
  if (
    (target.relations?.edges ?? []).some(
      (edge) => FRANCHISE.has(edge.relationType) && historyIds.has(edge.node.id),
    )
  )
    return true;
  return history.some((entry) =>
    (fixture.media[entry.mediaId]?.relations?.edges ?? []).some(
      (edge) => FRANCHISE.has(edge.relationType) && edge.node.id === target.id,
    ),
  );
}

describe.skipIf(!fixtureFile)("For You offline evaluation", () => {
  it("ranks held-out liked titles", () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, fixtureFile!), "utf8")) as Fixture;
    const now = Date.parse(fixture.capturedAt);
    const allEntries = [...fixture.lists.ANIME, ...fixture.lists.MANGA].filter(
      (entry) => fixture.media[entry.mediaId],
    );
    const userMean = meanScore(allEntries);
    const report: Record<string, unknown> = {
      fixture: fixtureFile,
      capturedAt: fixture.capturedAt,
      userMean,
    };

    const rankingRankers: Record<string, Ranker> = {
      current: currentRanker,
      "current+rich": currentRichRanker,
      hybrid: hybridRanker(),
      shipped: shippedRanker,
      popularity: popularityRanker,
    };

    for (const type of ["ANIME", "MANGA"] as MediaType[]) {
      const positives = fixture.lists[type]
        .filter((entry) => (affinity(entry, userMean) ?? 0) >= 0.5)
        .sort((a, b) => hash(a.mediaId) - hash(b.mediaId))
        .slice(0, MAX_HOLDOUTS);
      if (positives.length < 3) continue;

      const rows: Record<string, Tally> = {};
      const get = (name: string) => (rows[name] ??= tally());

      for (const target of positives) {
        const history = allEntries.filter((entry) => entry.mediaId !== target.mediaId);
        const excluded = new Set(history.map((entry) => entry.mediaId));
        const media = fixture.media[target.mediaId];
        const segment = isFranchise(media, history, fixture) ? "franchise" : "discovery";
        const base = { fixture, type, history, now };

        // A. Ranking only: every ranker sees the same full fixture universe of this type.
        const universe = Object.values(fixture.media).filter(
          (row) => row.type === type && !row.isAdult && !excluded.has(row.id),
        );
        for (const [name, ranker] of Object.entries(rankingRankers)) {
          const ranked = ranker({ ...base, pool: universe });
          record(get(`A ${name}`), ranked, target.mediaId, fixture);
          record(get(`A ${name} [${segment}]`), ranked, target.mediaId, fixture);
        }

        // B. End to end: each design retrieves its own pool.
        const currentPool = productionPool(base, excluded);
        record(
          get("B current"),
          currentRanker({ ...base, pool: currentPool }),
          target.mediaId,
          fixture,
        );
        const newPool = hybridPool(base, excluded);
        const rankedNew = hybridRanker()({ ...base, pool: newPool });
        record(get("B hybrid"), rankedNew, target.mediaId, fixture);
        record(get(`B hybrid [${segment}]`), rankedNew, target.mediaId, fixture);
        for (const genres of [0, 1]) {
          const pool = hybridPool(base, excluded, genres);
          const ranked = shippedRanker({ ...base, pool });
          record(get(`B shipped g${genres}`), ranked, target.mediaId, fixture);
        }
        const rankedShipped = shippedRanker({ ...base, pool: newPool });
        record(get("B shipped"), rankedShipped, target.mediaId, fixture);
        record(get(`B shipped [${segment}]`), rankedShipped, target.mediaId, fixture);
      }

      const table = Object.fromEntries(
        Object.entries(rows)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, t]) => [name, summarize(t)]),
      );
      report[`${type}:holdouts`] = positives.length;
      report[type] = table;
    }
    writeFileSync(join(FIXTURE_DIR, "eval-report.json"), JSON.stringify(report, null, 2));
  });
});
