// Two-fold weight search for the hybrid ranker. Run: EVAL_GRID=1 npx vitest run -c vitest.eval.config.ts weights
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  affinity,
  hybridRanker,
  meanScore,
  type Fixture,
  type HybridWeights,
  type MediaType,
} from "./recommendation-lab";

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "personal");
const fixtureFile = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).find((name) => /^anilist-.+\.json$/.test(name))
  : undefined;

function hash(value: number): number {
  let x = value ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

describe.skipIf(!fixtureFile || !process.env.EVAL_GRID)("hybrid weight search", () => {
  it("cross-validates weights", () => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, fixtureFile!), "utf8")) as Fixture;
    const now = Date.parse(fixture.capturedAt);
    const all = [...fixture.lists.ANIME, ...fixture.lists.MANGA].filter(
      (e) => fixture.media[e.mediaId],
    );
    const userMean = meanScore(all);

    // Precompute each holdout's history and universe once.
    const cases = (["ANIME", "MANGA"] as MediaType[]).flatMap((type) =>
      fixture.lists[type]
        .filter((entry) => (affinity(entry, userMean) ?? 0) >= 0.5)
        .sort((a, b) => hash(a.mediaId) - hash(b.mediaId))
        .slice(0, 80)
        .map((target) => {
          const history = all.filter((entry) => entry.mediaId !== target.mediaId);
          const excluded = new Set(history.map((entry) => entry.mediaId));
          const pool = Object.values(fixture.media).filter(
            (row) => row.type === type && !row.isAdult && !excluded.has(row.id),
          );
          return {
            type,
            target: target.mediaId,
            history,
            pool,
            fold: hash(target.mediaId * 7) % 2,
          };
        }),
    );

    const grid: HybridWeights[] = [];
    for (const graph of [0.3, 0.5, 0.7])
      for (const content of [0.15, 0.3, 0.45])
        for (const popularity of [0, 0.15, 0.3, 0.45])
          for (const quality of [0, 0.1])
            for (const crossTypePrior of [0, 0.35])
              for (const halfLifeDays of [180, 730])
                grid.push({ graph, content, popularity, quality, crossTypePrior, halfLifeDays });

    const results = grid.map((weights) => {
      const ranker = hybridRanker(weights);
      const ndcg = [0, 0];
      const hits = [0, 0];
      const n = [0, 0];
      for (const c of cases) {
        const index = ranker({
          fixture,
          type: c.type,
          history: c.history,
          pool: c.pool,
          now,
        }).indexOf(c.target);
        n[c.fold] += 1;
        if (index >= 0 && index < 10) {
          hits[c.fold] += 1;
          ndcg[c.fold] += 1 / Math.log2(index + 2);
        }
      }
      return { weights, ndcg: ndcg.map((v, i) => v / n[i]), hr: hits.map((v, i) => v / n[i]) };
    });

    const best = (fold: number) => results.reduce((a, b) => (b.ndcg[fold] > a.ndcg[fold] ? b : a));
    const pickA = best(0);
    const pickB = best(1);
    const overall = results.reduce((a, b) =>
      b.ndcg[0] + b.ndcg[1] > a.ndcg[0] + a.ndcg[1] ? b : a,
    );
    const report = {
      cases: cases.length,
      tunedOnFold0_testFold1: { weights: pickA.weights, ndcg: pickA.ndcg[1], hr: pickA.hr[1] },
      tunedOnFold1_testFold0: { weights: pickB.weights, ndcg: pickB.ndcg[0], hr: pickB.hr[0] },
      bestOverall: overall,
      top10: [...results]
        .sort((a, b) => b.ndcg[0] + b.ndcg[1] - (a.ndcg[0] + a.ndcg[1]))
        .slice(0, 10),
    };
    writeFileSync(join(FIXTURE_DIR, "weights-report.json"), JSON.stringify(report, null, 2));
  });
});
