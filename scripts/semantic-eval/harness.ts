/**
 * Runs the labelled fixture queries through the real search action and reports recall@5, MRR and
 * latency, per category; measures the Related threshold on the labelled pairs; and sweeps the
 * tunables in SEMANTIC_TUNING. Used by the offline eval test and `npm run eval:semantic`.
 */
import { api } from "../../convex/_generated/api";
import { cosine, SEMANTIC_TUNING } from "../../shared/semantic-ranking";
import type { SemanticResult } from "../../shared/semantic-types";
import { EVAL_NOW, FIXTURE_QUERIES, RELATED_PAIRS, type FixtureQuery } from "./fixtures";
import type { SemanticWorld } from "./world";

export type QueryOutcome = {
  query: string; category: FixtureQuery["category"]; relevant: string[]; top: string[]; rank: number | null;
  recallAt5: number; reciprocalRank: number; tookMs: number; mode: string;
};
export type EvalMetrics = { recallAt5: number; mrr: number; top1: number; queries: number; p50Ms: number; p95Ms: number };
export type EvalReport = {
  overall: EvalMetrics;
  byCategory: Record<string, EvalMetrics>;
  outcomes: QueryOutcome[];
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;
};

function metrics(outcomes: QueryOutcome[]): EvalMetrics {
  const mean = (pick: (outcome: QueryOutcome) => number) => outcomes.reduce((total, outcome) => total + pick(outcome), 0) / (outcomes.length || 1);
  const round = (value: number) => Math.round(value * 1_000) / 1_000;
  return { recallAt5: round(mean((outcome) => outcome.recallAt5)), mrr: round(mean((outcome) => outcome.reciprocalRank)),
    top1: round(mean((outcome) => (outcome.rank === 1 ? 1 : 0))), queries: outcomes.length,
    p50Ms: percentile(outcomes.map((outcome) => outcome.tookMs), 0.5), p95Ms: percentile(outcomes.map((outcome) => outcome.tookMs), 0.95) };
}

export async function runQueries(world: SemanticWorld, queries = FIXTURE_QUERIES): Promise<EvalReport> {
  const keyOf = new Map(Object.entries(world.ids).map(([key, id]) => [id, key]));
  const outcomes: QueryOutcome[] = [];
  for (const fixture of queries) {
    const started = performance.now();
    const response = await world.ana.action(api.semantic.search, { query: fixture.query, limit: 10,
      hints: { now: EVAL_NOW, timezoneOffsetMinutes: 0,
        openItemIds: fixture.hints?.open?.map((key) => world.ids[key]!), recentItemIds: fixture.hints?.recent?.map((key) => world.ids[key]!) } });
    // Wall time, in-process: it excludes the network and the deployment's own overhead.
    const tookMs = Math.round((performance.now() - started) * 10) / 10;
    const top = response.results.map((result: SemanticResult) => keyOf.get(result.itemId) ?? `?${result.itemId}`);
    const index = top.findIndex((key) => fixture.relevant.includes(key));
    const found = fixture.relevant.filter((key) => top.slice(0, 5).includes(key)).length;
    outcomes.push({ query: fixture.query, category: fixture.category, relevant: fixture.relevant, top: top.slice(0, 5),
      rank: index >= 0 ? index + 1 : null, recallAt5: found / fixture.relevant.length, reciprocalRank: index >= 0 ? 1 / (index + 1) : 0,
      tookMs, mode: response.mode });
  }
  const categories = [...new Set(outcomes.map((outcome) => outcome.category))];
  return { overall: metrics(outcomes), outcomes,
    byCategory: Object.fromEntries(categories.map((category) => [category, metrics(outcomes.filter((outcome) => outcome.category === category))])) };
}

/** Centroid similarity of the labelled pairs and the threshold that separates them best. */
export async function relatedThreshold(world: SemanticWorld) {
  const centroids = new Map(await world.t.run(async (ctx) =>
    (await ctx.db.query("semanticItems").collect()).map((row) => [row.itemId, row.centroid ?? null] as const)));
  const pairs = RELATED_PAIRS.map((pair) => {
    const a = centroids.get(world.ids[pair.a]!);
    const b = centroids.get(world.ids[pair.b]!);
    return { ...pair, similarity: a && b ? Math.round(cosine(a, b) * 1_000) / 1_000 : 0 };
  });
  let best = { threshold: SEMANTIC_TUNING.relatedMinSimilarity, f1: -1 };
  for (let threshold = 0.2; threshold <= 0.9; threshold += 0.01) {
    const tp = pairs.filter((pair) => pair.related && pair.similarity >= threshold).length;
    const fp = pairs.filter((pair) => !pair.related && pair.similarity >= threshold).length;
    const fn = pairs.filter((pair) => pair.related && pair.similarity < threshold).length;
    const f1 = tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
    // Prefer the highest threshold among equals: Related should be precise.
    if (f1 >= best.f1) best = { threshold: Math.round(threshold * 100) / 100, f1: Math.round(f1 * 1_000) / 1_000 };
  }
  return { pairs, best };
}

/** Sweeps RRF k with the other tunables fixed; restores the tuned value afterwards. */
export async function sweepRrfK(world: SemanticWorld, values = [5, 10, 20, 40, 60]) {
  const original = SEMANTIC_TUNING.rrfK;
  const results: Array<{ rrfK: number } & EvalMetrics> = [];
  try {
    for (const rrfK of values) {
      SEMANTIC_TUNING.rrfK = rrfK;
      results.push({ rrfK, ...(await runQueries(world)).overall });
    }
  } finally { SEMANTIC_TUNING.rrfK = original; }
  return results;
}

export function formatReport(label: string, report: EvalReport) {
  const lines = [`# Semantic eval: ${label}`, "",
    `overall: recall@5 ${report.overall.recallAt5}, MRR ${report.overall.mrr}, top-1 ${report.overall.top1}, ` +
      `p50 ${report.overall.p50Ms} ms, p95 ${report.overall.p95Ms} ms (${report.overall.queries} queries)`, ""];
  for (const [category, value] of Object.entries(report.byCategory))
    lines.push(`- ${category}: recall@5 ${value.recallAt5}, MRR ${value.mrr}, top-1 ${value.top1} (${value.queries})`);
  lines.push("", "| query | rank | top 5 |", "|---|---|---|");
  for (const outcome of report.outcomes)
    lines.push(`| ${outcome.query} | ${outcome.rank ?? "miss"} | ${outcome.top.join(", ")} |`);
  return lines.join("\n");
}
